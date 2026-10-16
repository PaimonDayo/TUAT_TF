// Node-only private storage. The directory is owned by the app, never served as public assets.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, link, unlink } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { isSafeAvatarStoragePath } from "./avatar-image";
import { isSafeTweetImagePath } from "./tweet-image";

const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
type FailureCode = "CONFIG" | "PATH" | "MISSING" | "CONFLICT" | "UNAVAILABLE" | "CAPACITY" | "READ_ONLY" | "PAUSED";

export class LocalImageStorageError extends Error {
  constructor(public readonly code: FailureCode, message = "Local image storage is unavailable") {
    super(message);
    this.name = "LocalImageStorageError";
  }
}

export function localImageStorageEnabled(): boolean {
  const driver = process.env.IMAGE_STORAGE_DRIVER;
  if (!driver) return false;
  if (driver !== "local") throw new LocalImageStorageError("CONFIG", "Unsupported image storage driver");
  return true;
}

function config() {
  if (!localImageStorageEnabled()) throw new LocalImageStorageError("CONFIG");
  const root = process.env.LOCAL_IMAGE_STORAGE_ROOT;
  const secret = process.env.LOCAL_IMAGE_SIGNING_KEY;
  const limit = Number(process.env.LOCAL_IMAGE_MAX_STORAGE_BYTES ?? 8_000_000_000);
  const maxObjects = Number(process.env.LOCAL_IMAGE_MAX_OBJECTS ?? 25_000);
  const maxFolderObjects = Number(process.env.LOCAL_IMAGE_MAX_FOLDER_OBJECTS ?? 2_000);
  const maxFolderBytes = Number(process.env.LOCAL_IMAGE_MAX_FOLDER_BYTES ?? 512 * 1024 * 1024);
  if (!root || !isAbsolute(root) || root !== resolve(root) || root === parse(root).root || !secret || Buffer.byteLength(secret) < 32 ||
      ![limit,maxObjects,maxFolderObjects,maxFolderBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new LocalImageStorageError("CONFIG");
  // Keep data outside the app, including public and every configured Next distDir.
  const fromApp = relative(process.cwd(), root);
  if (!fromApp || (!fromApp.startsWith(`..${sep}`) && fromApp !== ".." && !isAbsolute(fromApp))) {
    throw new LocalImageStorageError("CONFIG");
  }
  return { root, secret, limit, maxObjects, maxFolderObjects, maxFolderBytes };
}

function safeKey(key: string) {
  const slash = key.indexOf("/");
  const bucket = key.slice(0, slash);
  const path = key.slice(slash + 1);
  if (slash < 0 || !(bucket === "avatars" ? isSafeAvatarStoragePath(path)
    : (bucket === "tweet-images" || bucket === "note-images") && isSafeTweetImagePath(path))) {
    throw new LocalImageStorageError("PATH");
  }
  return key.split("/");
}

function sanitizedFailure(error: unknown): never {
  if (error instanceof LocalImageStorageError) throw error;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") throw new LocalImageStorageError("MISSING", "Image not found");
  if (code === "EEXIST") throw new LocalImageStorageError("CONFLICT", "Image already exists");
  // Native errors include absolute filesystem paths. Do not pass them to API logs.
  throw new LocalImageStorageError("UNAVAILABLE");
}

async function directory(path: string, create: boolean, privateDirectory = false) {
  let info;
  try { info = await lstat(path); } catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try { await mkdir(path, { mode: 0o700 }); } catch (created) {
      if ((created as NodeJS.ErrnoException).code !== "EEXIST") throw created;
    }
    info = await lstat(path);
  }
  if (!info.isDirectory() || info.isSymbolicLink() ||
      (privateDirectory && process.platform !== "win32" && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid!()))) {
    throw new LocalImageStorageError("UNAVAILABLE");
  }
}

async function storageRoot(root: string, create: boolean) {
  const volume = parse(root).root;
  let path = volume;
  // Reject symlinks in *every* ancestor before following or creating descendants.
  for (const part of root.slice(volume.length).split(sep).filter(Boolean)) {
    path = join(path, part);
    try { await directory(path, create, path === root); }
    catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") throw new LocalImageStorageError("UNAVAILABLE");
      throw error;
    }
  }
}

async function imagePath(root: string, key: string, create: boolean) {
  const parts = safeKey(key);
  await storageRoot(root, create);
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    await directory(parent, create, true);
  }
  return join(parent, parts.at(-1)!);
}

async function imageFile(root: string, key: string) {
  const path = await imagePath(root, key, false);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    // No symlinks, devices or hard links into files outside the storage directory.
    const entry = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || entry.isSymbolicLink() || entry.ino !== info.ino ||
        entry.dev !== info.dev || info.size > MAX_IMAGE_BYTES) throw new LocalImageStorageError("UNAVAILABLE");
    return { handle, size: info.size };
  } catch (error) { await handle.close(); throw error; }
}

async function syncDirectory(path: string) {
  if (process.platform === "win32") return;
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function inventory(root: string, folder?: string) {
  let bytes = 0;
  let objects = 0;
  let folderBytes = 0;
  let folderObjects = 0;
  async function walk(path: string, depth: number) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      const info = await lstat(child);
      if (info.isSymbolicLink()) throw new LocalImageStorageError("UNAVAILABLE");
      if (info.isDirectory() && depth < 2) {
        await directory(child, false, true);
        await walk(child, depth + 1);
      } else if (info.isFile() && info.nlink === 1) {
        bytes += info.size;
        objects++;
        if(folder && relative(root,child).split(sep).slice(0,2).join("/")===folder) {
          folderBytes += info.size;
          folderObjects++;
        }
      } else throw new LocalImageStorageError("UNAVAILABLE");
    }
  }
  await walk(root, 0);
  return { bytes, objects, folderBytes, folderObjects };
}

// There is one Next process. Serialize its capacity checks and filesystem mutations.
// Exclusive final-path creation also protects immutable objects across process restarts.
const mutations = new Map<string, Promise<unknown>>();
async function mutate<T>(root: string, action: () => Promise<T>): Promise<T> {
  const previous = mutations.get(root) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(action);
  mutations.set(root, operation);
  try { return await operation; } finally {
    if (mutations.get(root) === operation) mutations.delete(root);
  }
}

function writable() {
  if (process.env.IMAGE_STORAGE_READ_ONLY === "true") throw new LocalImageStorageError("READ_ONLY", "画像は読み取り専用です");
}

export async function localImageInventory() {
  try {
    const { root } = config();
    await storageRoot(root, process.env.IMAGE_STORAGE_READ_ONLY !== "true");
    const { bytes, objects } = await inventory(root);
    return { bytes, objects };
  } catch (error) { sanitizedFailure(error); }
}

export async function uploadLocalImage(key: string, bytes: Buffer) {
  try {
    safeKey(key);
    const { root, limit, maxObjects, maxFolderObjects, maxFolderBytes } = config();
    writable();
    if (process.env.LOCAL_IMAGE_UPLOADS_PAUSED === "true") throw new LocalImageStorageError("PAUSED", "画像の保存を一時停止しています");
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new LocalImageStorageError("CAPACITY", "画像の容量が大きすぎます");
    await mutate(root, async () => {
      const target = await imagePath(root, key, true);
      const usage = await inventory(root,key.split("/").slice(0,2).join("/"));
      if (usage.bytes + bytes.length > limit || usage.objects >= maxObjects ||
          usage.folderBytes + bytes.length > maxFolderBytes || usage.folderObjects >= maxFolderObjects) {
        throw new LocalImageStorageError("CAPACITY", "画像の保存容量が上限に達しました");
      }
      const temporary = join(parse(target).dir, `.upload-${randomUUID()}.tmp`);
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally { await handle.close(); }
        // Atomic publication of complete bytes; link refuses existing destinations.
        await link(temporary, target);
      } finally { await unlink(temporary); }
      await syncDirectory(parse(target).dir);
    });
  } catch (error) { sanitizedFailure(error); }
}

function signature(key: string, expires: number, secret: string) {
  return createHmac("sha256", secret).update(JSON.stringify(["local-image-v1", key, expires])).digest();
}

/** Issued only by the existing authenticated image APIs after their RLS checks. */
export async function signedLocalImageUrl(key: string, ttl: number, now = Date.now()) {
  try {
    safeKey(key);
    const { root, secret } = config();
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_TTL_SECONDS) throw new LocalImageStorageError("CONFIG");
    const { handle } = await imageFile(root, key);
    await handle.close();
    const expires = Math.floor(now / 1000) + ttl;
    const query = new URLSearchParams({ key, expires: String(expires), signature: signature(key, expires, secret).toString("hex") });
    return `/api/local-image?${query}`;
  } catch (error) { sanitizedFailure(error); }
}

export function verifyLocalImageSignature(key: string, expiry: string, value: string, now = Date.now()): boolean {
  try {
    safeKey(key);
    const { secret } = config();
    if (!/^[1-9][0-9]{0,15}$/.test(expiry) || !/^[a-f0-9]{64}$/.test(value)) return false;
    const expires = Number(expiry);
    const seconds = Math.floor(now / 1000);
    return Number.isSafeInteger(expires) && expires > seconds && expires <= seconds + MAX_TTL_SECONDS &&
      timingSafeEqual(signature(key, expires, secret), Buffer.from(value, "hex"));
  } catch (error) {
    if (error instanceof LocalImageStorageError && error.code === "PATH") return false;
    throw error;
  }
}

export async function readLocalImage(key: string, head = false) {
  try {
    const { root } = config();
    const { handle, size } = await imageFile(root, key);
    try { return { bytes: head ? undefined : await handle.readFile(), size, contentType: /\.jpe?g$/i.test(key) ? "image/jpeg" : "image/webp" }; }
    finally { await handle.close(); }
  } catch (error) { sanitizedFailure(error); }
}

export async function removeLocalImages(keys: string[]) {
  try {
    keys.forEach(safeKey);
    const { root } = config();
    writable();
    await mutate(root, async () => {
      const targets: string[] = [];
      // Validate the whole request before beginning deletions.
      for (const key of new Set(keys)) {
        try {
          const target = await imagePath(root, key, false);
          const { handle } = await imageFile(root, key);
          await handle.close();
          targets.push(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
      }
      let failed = false;
      for (const target of targets) {
        try { await unlink(target); await syncDirectory(parse(target).dir); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") failed = true;
        }
      }
      if (failed) throw new LocalImageStorageError("UNAVAILABLE", "Some local images could not be removed");
    });
  } catch (error) { sanitizedFailure(error); }
}
