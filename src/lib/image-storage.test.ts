import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ImageNotFoundError, imageObjectKey, readImageUpload, signedImageUrl, uploadImage, removeImages } from "./image-storage";

const mocks = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn(), config: vi.fn() }));
vi.mock("@aws-sdk/client-s3", async (original) => {
  const actual = await original<typeof import("@aws-sdk/client-s3")>();
  return { ...actual, S3Client: class { constructor(config: unknown) { mocks.config(config); } send = mocks.send; destroy() {} } };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));
const legacySign = vi.fn();
const legacyUpload = vi.fn();
const legacyRemove = vi.fn();
const supabase = { storage: { from: () => ({ createSignedUrl: legacySign, upload: legacyUpload, remove: legacyRemove }) } } as unknown as SupabaseClient;
const path = "user-1/avatar.webp";
beforeEach(() => {
  vi.stubEnv("R2_ACCOUNT_ID", "a".repeat(32));
  vi.stubEnv("R2_ACCESS_KEY_ID", "test");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test");
  vi.stubEnv("R2_BUCKET_NAME", "private-images");
  vi.stubEnv("R2_READ_ENABLED", "true");
  vi.stubEnv("R2_WRITE_ENABLED", "true");
  vi.stubEnv("R2_UPLOADS_PAUSED", "false");
  vi.stubEnv("R2_MAX_STORAGE_BYTES", "1000");
  mocks.send.mockReset().mockResolvedValue({});
  mocks.sign.mockReset().mockResolvedValue("https://r2.example/signed");
  legacySign.mockReset().mockResolvedValue({ data: { signedUrl: "https://supabase.example/signed" }, error: null });
  legacyUpload.mockReset().mockResolvedValue({ error: null });
  legacyRemove.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("private image storage migration", () => {
  it("uses one SDK attempt for mutations while reads retain two", async () => {
    vi.stubEnv("R2_BUCKET_NAME", "synthetic-attempt-proof"); mocks.config.mockClear();
    await uploadImage(supabase, "avatars", path, Buffer.from("abc"));
    await removeImages(supabase, "avatars", [path]);
    expect(mocks.config.mock.calls.map(([config]) => config.maxAttempts)).toEqual([2, 1]);
    const writes = mocks.send.mock.calls.filter(([command]) => ["PutObjectCommand", "DeleteObjectsCommand"].includes(command.constructor.name));
    expect(writes).toHaveLength(2);
  });
  it("never sends note photos to legacy Storage when R2 is unavailable", async()=>{
    const notePath="11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp";
    mocks.send.mockRejectedValueOnce({name:"NotFound",$metadata:{httpStatusCode:404}});
    await expect(signedImageUrl(supabase,"note-images",notePath,300)).rejects.toBeDefined();
    expect(legacySign).not.toHaveBeenCalled();
    vi.stubEnv("R2_WRITE_ENABLED","false");
    await expect(uploadImage(supabase,"note-images",notePath,Buffer.from("abc"))).rejects.toThrow("R2 writes");
    expect(legacyUpload).not.toHaveBeenCalled();
  });
  it("removes queued note photos from R2 without a nonexistent legacy bucket", async()=>{
    const notePath="11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp";
    await removeImages(supabase,"note-images",[notePath]);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(legacyRemove).not.toHaveBeenCalled();
  });
  it("rejects traversal and invalid namespaces before storage access", () => {
    expect(() => imageObjectKey("avatars", "../private/secret.webp")).toThrow();
    expect(() => imageObjectKey("avatars", "user/%2e%2e.webp")).toThrow();
    expect(() => imageObjectKey("tweet-images", path)).toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("signs the private R2 copy without downloading image bytes", async () => {
    expect(await signedImageUrl(supabase, "avatars", path, 300)).toBe("https://r2.example/signed");
    expect(mocks.send.mock.calls[0][0].constructor.name).toBe("HeadObjectCommand");
    expect(mocks.sign.mock.calls[0][1].input).toEqual({ Bucket: "private-images", Key: `avatars/${path}` });
    expect(legacySign).not.toHaveBeenCalled();
  });
  it("falls back for an old-client upload not yet copied to R2", async () => {
    mocks.send.mockRejectedValueOnce({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
    expect(await signedImageUrl(supabase, "avatars", path, 300)).toBe("https://supabase.example/signed");
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("does not silently fall back on R2 permission errors", async () => {
    mocks.send.mockRejectedValueOnce(new Error("Access denied"));
    await expect(signedImageUrl(supabase, "avatars", path, 300)).rejects.toThrow("Access denied");
    expect(legacySign).not.toHaveBeenCalled();
  });
  it("does not confuse a missing bucket with a missing image", async () => {
    const error = { name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } };
    mocks.send.mockRejectedValueOnce(error);
    await expect(signedImageUrl(supabase, "avatars", path, 300)).rejects.toBe(error);
    expect(legacySign).not.toHaveBeenCalled();
  });
  it("normalizes a confirmed missing object after checking the legacy provider", async () => {
    mocks.send.mockRejectedValueOnce({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    legacySign.mockResolvedValueOnce({ data: null, error: { status: 404, message: "Object not found" } });
    await expect(signedImageUrl(supabase, "avatars", path, 300)).rejects.toBeInstanceOf(ImageNotFoundError);
    expect(legacySign).toHaveBeenCalledOnce();
  });
  it("treats an incomplete signing response as unavailable", async () => {
    mocks.send.mockRejectedValueOnce({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
    legacySign.mockResolvedValueOnce({ data: null, error: null });
    await expect(signedImageUrl(supabase, "avatars", path, 300)).rejects.not.toBeInstanceOf(ImageNotFoundError);
  });
  it("keeps the old provider when the rollout is disabled", async () => {
    vi.stubEnv("R2_READ_ENABLED", "false");
    vi.stubEnv("R2_WRITE_ENABLED", "false");
    await signedImageUrl(supabase, "avatars", path, 300);
    await uploadImage(supabase, "avatars", path, Buffer.from("abc"));
    expect(mocks.send).not.toHaveBeenCalled();
    expect(legacySign).toHaveBeenCalledOnce();
    expect(legacyUpload).toHaveBeenCalledOnce();
  });
  it("refuses unreadable R2-only uploads", async () => {
    vi.stubEnv("R2_READ_ENABLED", "false");
    await expect(uploadImage(supabase, "avatars", path, Buffer.from("abc"))).rejects.toThrow("Enable R2 reads");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("counts every capacity page and refuses uploads above the threshold", async () => {
    mocks.send.mockResolvedValueOnce({ Contents: [{ Size: 500 }], IsTruncated: true, NextContinuationToken: "next" })
      .mockResolvedValueOnce({ Contents: [{ Size: 499 }] });
    await expect(uploadImage(supabase, "avatars", path, Buffer.from("abc"))).rejects.toThrow("上限");
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(legacyUpload).not.toHaveBeenCalled();
  });
  it("bounds the capacity walk and never uploads after an incomplete inventory", async () => {
    mocks.send.mockResolvedValue({ Contents: [], IsTruncated: true, NextContinuationToken: "next" });
    await expect(uploadImage(supabase, "avatars", path, Buffer.from("abc"))).rejects.toThrow("too large");
    expect(mocks.send).toHaveBeenCalledTimes(100);
    expect(mocks.send.mock.calls.every(([command]) => command.constructor.name === "ListObjectsV2Command")).toBe(true);
    expect(mocks.send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
  });
  it("refuses an upload when capacity enumeration fails", async () => {
    mocks.send.mockRejectedValueOnce(new Error("inventory timeout"));
    await expect(uploadImage(supabase, "avatars", path, Buffer.from("abc"))).rejects.toThrow("timeout");
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it("stops writes while keeping reads available", async () => {
    vi.stubEnv("R2_UPLOADS_PAUSED", "true");
    await expect(uploadImage(supabase, "avatars", path, Buffer.from("abc"))).rejects.toThrow("一時停止");
    await expect(signedImageUrl(supabase, "avatars", path, 300)).resolves.toContain("r2.example");
  });
  it("never overwrites an existing image", async () => {
    await uploadImage(supabase, "avatars", path, Buffer.from("abc"));
    expect(mocks.send.mock.calls[1][0].input.IfNoneMatch).toBe("*");
    expect(legacyUpload).not.toHaveBeenCalled();
  });
  it("removes both copies to prevent deleted images returning from fallback", async () => {
    await removeImages(supabase, "avatars", [path]);
    expect(mocks.send.mock.calls[0][0].input.Delete.Objects).toEqual([{ Key: `avatars/${path}` }]);
    expect(legacyRemove).toHaveBeenCalledWith([path]);
  });
  it("does not report a partially failed R2 delete as success", async () => {
    mocks.send.mockResolvedValueOnce({ Errors: [{ Key: `avatars/${path}`, Code: "AccessDenied" }] });
    await expect(removeImages(supabase, "avatars", [path])).rejects.toThrow("could not be removed");
    expect(legacyRemove).not.toHaveBeenCalled();
  });
});
describe("bounded image upload input", () => {
  it("reads a normal image body up to its byte limit", async () => {
    const request = new Request("https://app.example/upload", { method: "POST", body: "abcd" });
    expect(await readImageUpload(request, 4)).toEqual(Buffer.from("abcd"));
  });
  it("stops a chunked oversized body regardless of its declared length", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(3)); },
      cancel: cancelled,
    });
    const request = new Request("https://app.example/upload", { method: "POST", body, duplex: "half", headers: { "Content-Length": "1" } } as RequestInit);
    await expect(readImageUpload(request, 4)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("rejects a declared oversized body before reading it", async () => {
    const request = new Request("https://app.example/upload", { method: "POST", body: "abcd", headers: { "Content-Length": "5" } });
    await expect(readImageUpload(request, 4)).rejects.toMatchObject({ status: 413 });
    expect(request.bodyUsed).toBe(false);
  });
  it("bounds a stalled body and cancels its reader", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const request = new Request("https://app.example/upload", { method: "POST", body, duplex: "half" } as RequestInit);
    try {
      const assertion = expect(readImageUpload(request, 4)).rejects.toMatchObject({ status: 408 });
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
      expect(cancelled).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
it("blocks uploads and removals during a local restore rehearsal while allowing reads",async()=>{
  vi.stubEnv("IMAGE_STORAGE_READ_ONLY","true");
  await expect(uploadImage(supabase,"avatars",path,Buffer.from("image"))).rejects.toThrow("読み取り専用");
  await expect(removeImages(supabase,"avatars",[path])).rejects.toThrow("読み取り専用");
  expect(mocks.send).not.toHaveBeenCalled();expect(legacyUpload).not.toHaveBeenCalled();expect(legacyRemove).not.toHaveBeenCalled();
  await expect(signedImageUrl(supabase,"avatars",path,300)).resolves.toContain("r2.example");
});
