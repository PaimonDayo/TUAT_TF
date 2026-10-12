import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GET, HEAD } from "@/app/api/local-image/route";
import { ImageNotFoundError, signedImageUrl, uploadImage, removeImages } from "./image-storage";
import { localImageInventory, uploadLocalImage } from "./local-image-storage";

const path = "member-1/avatar.webp";
let temporary: string, root: string, bytes: Buffer;
const client = { storage: { from: () => { throw new Error("Cloud storage must not be contacted"); } } } as unknown as SupabaseClient;
beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), "tuat-pc-local-images-")); root = join(temporary, "images");
  for (const [name, value] of Object.entries({ PC_APP_RUNTIME: "false", NEXT_PUBLIC_PC_APP_RUNTIME: "false", IMAGE_STORAGE_DRIVER: "local",
    LOCAL_IMAGE_STORAGE_ROOT: root, LOCAL_IMAGE_SIGNING_KEY: "synthetic-local-image-key-".repeat(3), LOCAL_IMAGE_MAX_STORAGE_BYTES: "1000",
    IMAGE_STORAGE_READ_ONLY: "false", R2_READ_ENABLED: "false", R2_WRITE_ENABLED: "false" })) vi.stubEnv(name, value);
  bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).webp().toBuffer();
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(temporary, { recursive: true, force: true }); });
const request = (url: string, method = "GET") => new Request(new URL(url, "https://pc.example.test"), { method });

it("stores real WebP privately, signs and serves GET/HEAD, then deletes without cloud fallback", async () => {
  await uploadImage(client, "avatars", path, bytes);
  expect(await readFile(join(root, "avatars", path))).toEqual(bytes);
  const url = await signedImageUrl(client, "avatars", path, 7 * 86400);
  const response = await GET(request(url));
  expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  expect(response.headers.get("cache-control")).toBe("private, max-age=518400");
  const head = await HEAD(request(url, "HEAD")); expect(head.status).toBe(200); expect(await head.text()).toBe("");
  expect(head.headers.get("content-length")).toBe(String(bytes.length));
  await removeImages(client, "avatars", [path]);
  expect((await GET(request(url))).status).toBe(404);
  await expect(signedImageUrl(client, "avatars", path, 30)).rejects.toBeInstanceOf(ImageNotFoundError);
});
it("refuses tampered, expired, duplicate and unsigned capabilities", async () => {
  await uploadImage(client, "avatars", path, bytes);
  const url = await signedImageUrl(client, "avatars", path, 60);
  for (const altered of [url.replace("member-1", "member-2"), url.replace(/signature=./, "signature=z"), `${url}&key=avatars%2Fother%2Favatar.webp`, "/api/local-image"]) {
    expect((await GET(request(altered))).status).toBe(403);
  }
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 61_000);
  try { expect((await GET(request(url))).status).toBe(403); } finally { vi.useRealTimers(); }
});
it("keeps complete immutable bytes on conflict, capacity failure and read-only rejection", async () => {
  await uploadImage(client, "avatars", path, bytes);
  await expect(uploadImage(client, "avatars", path, Buffer.from("replacement"))).rejects.toMatchObject({ code: "CONFLICT" });
  vi.stubEnv("LOCAL_IMAGE_MAX_STORAGE_BYTES", String(bytes.length));
  await expect(uploadLocalImage("avatars/member-2/avatar.webp", bytes)).rejects.toMatchObject({ code: "CAPACITY" });
  vi.stubEnv("IMAGE_STORAGE_READ_ONLY", "true");
  await expect(removeImages(client, "avatars", [path])).rejects.toThrow("読み取り専用");
  expect(await readFile(join(root, "avatars", path))).toEqual(bytes);
  expect(await localImageInventory()).toEqual({ bytes: bytes.length, objects: 1 });
});
it("rejects public/release placement and traversal before publishing bytes", async () => {
  vi.stubEnv("LOCAL_IMAGE_STORAGE_ROOT", join(process.cwd(), "public", "images"));
  await expect(uploadLocalImage("avatars/member-1/avatar.webp", bytes)).rejects.toMatchObject({ code: "CONFIG" });
  vi.stubEnv("LOCAL_IMAGE_STORAGE_ROOT", root);
  await expect(uploadLocalImage("avatars/member-1/../avatar.webp", bytes)).rejects.toMatchObject({ code: "PATH" });
});
it("reports a lost storage root as unavailable rather than a missing photograph", async () => {
  await uploadImage(client,"avatars",path,bytes);const url=await signedImageUrl(client,"avatars",path,60);
  await rm(root,{recursive:true,force:true});
  expect((await GET(request(url))).status).toBe(503);
  await expect(signedImageUrl(client,"avatars",path,60)).rejects.not.toBeInstanceOf(ImageNotFoundError);
});
