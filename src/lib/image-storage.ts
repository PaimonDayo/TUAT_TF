// Server-side only. Credentials must never be NEXT_PUBLIC_* variables.
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSafeAvatarStoragePath } from "./avatar-image";
import { isSafeTweetImagePath } from "./tweet-image";

export type ImageBucket = "avatars" | "tweet-images" | "note-images";
let cached: { signature: string; bucket: string; client: S3Client } | undefined;

export function imageObjectKey(bucket: ImageBucket, path: string): string {
  const valid = bucket === "avatars" ? isSafeAvatarStoragePath(path)
    : (bucket === "tweet-images" || bucket === "note-images") && isSafeTweetImagePath(path);
  if (!valid) throw new Error("Invalid image path");
  return `${bucket}/${path}`;
}

function r2() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (!R2_ACCOUNT_ID || !/^[a-f0-9]{32}$/i.test(R2_ACCOUNT_ID) || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw new Error("R2 configuration is incomplete");
  }
  const signature = JSON.stringify([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME]);
  if (cached?.signature === signature) return cached;
  cached?.client.destroy();
  cached = { signature, bucket: R2_BUCKET_NAME, client: new S3Client({
    region: "auto", endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 2,
  }) };
  return cached;
}

function isMissing(error: unknown) {
  return typeof error === "object" && error !== null && "$metadata" in error &&
    (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 404;
}

/** Admin-only inventory. Bound duration and page count so monitoring stays cheap. */
export async function getR2Inventory() {
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
  if (bucket === "note-images" && process.env.R2_READ_ENABLED !== "true") throw new Error("R2 reads are unavailable");
  if (process.env.R2_READ_ENABLED === "true") {
    const { client, bucket: r2Bucket } = r2();
    try {
      await client.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }));
      return await getSignedUrl(client, new GetObjectCommand({ Bucket: r2Bucket, Key: key }), { expiresIn: ttl });
    } catch (error) {
      // Only a missing copy falls back. Never hide invalid credentials/outages.
      if (!isMissing(error) || bucket === "note-images") throw error;
    }
  }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) throw error ?? new Error("Image not found");
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
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const object of page.Contents ?? []) bytes += object.Size ?? 0;
    if (bytes > limit) throw new Error("画像の保存容量が上限に達しました");
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !token) throw new Error("Incomplete R2 capacity response");
  } while (token);
}

export async function uploadImage(supabase: SupabaseClient, bucket: ImageBucket, path: string, bytes: Buffer) {
  if (process.env.IMAGE_STORAGE_READ_ONLY === "true") throw new Error("画像は読み取り専用です");
  const key = imageObjectKey(bucket, path);
  if (bucket === "note-images" && process.env.R2_WRITE_ENABLED !== "true") throw new Error("R2 writes are unavailable");
  if (process.env.R2_WRITE_ENABLED === "true") {
    // New R2-only files must remain readable immediately after saving.
    if (process.env.R2_READ_ENABLED !== "true") throw new Error("Enable R2 reads before writes");
    const { client, bucket: r2Bucket } = r2();
    await assertCapacity(client, r2Bucket, bytes.length);
    await client.send(new PutObjectCommand({ Bucket: r2Bucket, Key: key, Body: bytes,
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
  if (process.env.IMAGE_STORAGE_READ_ONLY === "true") throw new Error("画像は読み取り専用です");
  if (bucket === "note-images" || process.env.R2_READ_ENABLED === "true" || process.env.R2_WRITE_ENABLED === "true") {
    const { client, bucket: r2Bucket } = r2();
    for (let offset = 0; offset < keys.length; offset += 1000) {
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
