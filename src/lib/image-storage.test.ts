import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { imageObjectKey, signedImageUrl, uploadImage, removeImages } from "./image-storage";

const mocks = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn() }));
vi.mock("@aws-sdk/client-s3", async (original) => {
  const actual = await original<typeof import("@aws-sdk/client-s3")>();
  return { ...actual, S3Client: class { send = mocks.send; destroy() {} } };
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
    mocks.send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect(await signedImageUrl(supabase, "avatars", path, 300)).toBe("https://supabase.example/signed");
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("does not silently fall back on R2 permission errors", async () => {
    mocks.send.mockRejectedValueOnce(new Error("Access denied"));
    await expect(signedImageUrl(supabase, "avatars", path, 300)).rejects.toThrow("Access denied");
    expect(legacySign).not.toHaveBeenCalled();
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
