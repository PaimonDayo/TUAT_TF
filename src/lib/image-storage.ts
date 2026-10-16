// Server-side only. Credentials must never be NEXT_PUBLIC_* variables.
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSafeAvatarStoragePath } from "./avatar-image";
import { isSafeTweetImagePath } from "./tweet-image";
import { assertPcAppWriteAllowed } from "./pc-backup-status";
import { LocalImageStorageError, localImageStorageEnabled, localImageInventory, signedLocalImageUrl, uploadLocalImage, removeLocalImages } from "./local-image-storage";

export type ImageBucket = "avatars" | "tweet-images" | "note-images";
let cached: { signature: string; bucket: string; client: S3Client } | undefined;
let cachedMutation: typeof cached;

export class ImageNotFoundError extends Error {
  constructor() { super("Image object not found"); this.name = "ImageNotFoundError"; }
}

export class ImageUploadError extends Error {
  constructor(public readonly status: 400 | 408 | 413 | 429, message: string) { super(message); this.name = "ImageUploadError"; }
}

/** Diagnostics contain a fixed operation name only, never provider exceptions or image paths. */
export function logImageFailure(operation: string) {
  console.warn("Image operation unavailable", { operation });
}

/** Bound buffered upload bytes even when Content-Length is missing or incorrect. */
export async function readImageUpload(request: Request, maxBytes: number): Promise<Buffer> {
  const oversized = () => new ImageUploadError(413, "画像の容量が大きすぎます");
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw oversized();
  if (!request.body) throw oversized();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let abortRead: () => void = () => undefined;
  const interrupted = new Promise<never>((_, reject) => {
    abortRead = () => reject(new ImageUploadError(408, "画像の受信を確認できませんでした"));
  });
  const timer = setTimeout(abortRead, 30_000);
  request.signal.addEventListener("abort", abortRead, { once: true });
  if (request.signal.aborted) abortRead();
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw oversized();
      chunks.push(value);
    }
    if (!length) throw oversized();
    return Buffer.concat(chunks, length);
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof ImageUploadError) throw error;
    throw new ImageUploadError(400, "画像を読み込めませんでした");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
}

export function imageObjectKey(bucket: ImageBucket, path: string): string {
  const valid = bucket === "avatars" ? isSafeAvatarStoragePath(path)
    : (bucket === "tweet-images" || bucket === "note-images") && isSafeTweetImagePath(path);
  if (!valid) throw new Error("Invalid image path");
  return `${bucket}/${path}`;
}

function r2(mutation = false) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (!R2_ACCOUNT_ID || !/^[a-f0-9]{32}$/i.test(R2_ACCOUNT_ID) || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw new Error("R2 configuration is incomplete");
  }
  const signature = JSON.stringify([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME]);
  const previous = mutation ? cachedMutation : cached;
  if (previous?.signature === signature) return previous;
  previous?.client.destroy();
  const current = { signature, bucket: R2_BUCKET_NAME, client: new S3Client({
    region: "auto", endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: mutation ? 1 : 2,
  }) };
  if (mutation) cachedMutation = current; else cached = current;
  return current;
}

function isMissing(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const failure = error as { name?: string; code?: string; status?: number; statusCode?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  if (failure.$metadata?.httpStatusCode === 404) {
    // A missing bucket/configuration is a dependency failure, not a missing photo.
    return failure.name === "NotFound" || failure.name === "NoSuchKey";
  }
  return ["NoSuchKey", "ObjectNotFound", "object_not_found"].includes(failure.code ?? failure.statusCode ?? "") ||
    ((failure.status === 404 || failure.statusCode === "404") && failure.message === "Object not found");
}

/** Admin-only inventory. Bound duration and page count so monitoring stays cheap. */
export async function getR2Inventory() {
  if (localImageStorageEnabled()) return localImageInventory();
  const { client, bucket } = r2();
  const signal = AbortSignal.timeout(8000);
  let bytes = 0;
  let objects = 0;
  let token: string | undefined;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }), { abortSignal: signal });
    for (const object of page.Contents ?? []) {
      bytes += object.Size ?? 0;
      objects++;
    }
    if (!page.IsTruncated) return { bytes, objects };
    token = page.NextContinuationToken;
    if (!token) throw new Error("Incomplete R2 inventory");
  }
  throw new Error("R2 inventory is too large");
}

/** Call only after authenticating and checking the resource's existing RLS. */
export async function signedImageUrl(supabase: SupabaseClient, bucket: ImageBucket, path: string, ttl: number) {
  const key = imageObjectKey(bucket, path);
  if (localImageStorageEnabled()) {
    try { return await signedLocalImageUrl(key, ttl); }
    catch (error) { if (error instanceof LocalImageStorageError && error.code === "MISSING") throw new ImageNotFoundError(); throw error; }
  }
  if (bucket === "note-images" && process.env.R2_READ_ENABLED !== "true") throw new Error("R2 reads are unavailable");
  if (process.env.R2_READ_ENABLED === "true") {
    const { client, bucket: r2Bucket } = r2();
    try {
      await client.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }), { abortSignal: AbortSignal.timeout(8000) });
      return await getSignedUrl(client, new GetObjectCommand({ Bucket: r2Bucket, Key: key }), { expiresIn: ttl });
    } catch (error) {
      // Only a missing copy falls back. Never hide invalid credentials/outages.
      if (!isMissing(error)) throw error;
      if (bucket === "note-images") throw new ImageNotFoundError();
    }
  }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl);
  if (error) throw isMissing(error) ? new ImageNotFoundError() : error;
  if (!data?.signedUrl) throw new Error("Image signing response is incomplete");
  return data.signedUrl;
}

/** Conservative capacity guard; concurrent uploads can exceed this threshold slightly.
 * Keep headroom below the free tier. This is not a provider billing hard cap. */
async function assertCapacity(client: S3Client, bucket: string, incomingBytes: number) {
  if (process.env.R2_UPLOADS_PAUSED === "true") throw new Error("画像の保存を一時停止しています");
  const limit = Number(process.env.R2_MAX_STORAGE_BYTES ?? 8_000_000_000);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Invalid R2 capacity limit");
  let bytes = incomingBytes;
  let token: string | undefined;
  const signal = AbortSignal.timeout(8000);
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }), { abortSignal: signal });
    for (const object of page.Contents ?? []) bytes += object.Size ?? 0;
    if (bytes > limit) throw new Error("画像の保存容量が上限に達しました");
    if (!page.IsTruncated) return;
    token = page.NextContinuationToken;
    if (!token) throw new Error("Incomplete R2 capacity response");
  }
  throw new Error("R2 capacity inventory is too large");
}

export async function uploadImage(supabase: SupabaseClient, bucket: ImageBucket, path: string, bytes: Buffer) {
  await assertPcAppWriteAllowed();
  if (process.env.IMAGE_STORAGE_READ_ONLY === "true") throw new Error("画像は読み取り専用です");
  const key = imageObjectKey(bucket, path);
  if (localImageStorageEnabled()) return uploadLocalImage(key, bytes);
  if (bucket === "note-images" && process.env.R2_WRITE_ENABLED !== "true") throw new Error("R2 writes are unavailable");
  if (process.env.R2_WRITE_ENABLED === "true") {
    // New R2-only files must remain readable immediately after saving.
    if (process.env.R2_READ_ENABLED !== "true") throw new Error("Enable R2 reads before writes");
    const { client, bucket: r2Bucket } = r2();
    await assertCapacity(client, r2Bucket, bytes.length);
    await assertPcAppWriteAllowed();
    await r2(true).client.send(new PutObjectCommand({ Bucket: r2Bucket, Key: key, Body: bytes,
      ContentType: "image/webp", CacheControl: bucket === "avatars" ? "private, max-age=604800" : "private, max-age=240",
      IfNoneMatch: "*",
    }));
    return;
  }
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType: "image/webp", cacheControl: bucket === "avatars" ? "31536000" : "240", upsert: false,
  });
  if (error) throw error;
}

/** Used only for an owner-authorized removal or expired story cleanup. */
export async function removeImages(supabase: SupabaseClient, bucket: ImageBucket, paths: string[]) {
  const keys = paths.map((path) => imageObjectKey(bucket, path));
  if (!keys.length) return;
  await assertPcAppWriteAllowed();
  if (process.env.IMAGE_STORAGE_READ_ONLY === "true") throw new Error("画像は読み取り専用です");
  if (localImageStorageEnabled()) return removeLocalImages(keys);
  if (bucket === "note-images" || process.env.R2_READ_ENABLED === "true" || process.env.R2_WRITE_ENABLED === "true") {
    const { client, bucket: r2Bucket } = r2(true);
    for (let offset = 0; offset < keys.length; offset += 1000) {
      await assertPcAppWriteAllowed();
      const result = await client.send(new DeleteObjectsCommand({ Bucket: r2Bucket,
        Delete: { Objects: keys.slice(offset, offset + 1000).map((Key) => ({ Key })), Quiet: true },
      }));
      if (result.Errors?.length) throw new Error("Some R2 images could not be removed");
    }
  }
  if (bucket === "note-images") return;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw error;
}
