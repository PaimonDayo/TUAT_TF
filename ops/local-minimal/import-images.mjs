// Import an offline, frozen image snapshot into a private staging root. Node 24+.
// No DB writes, network fallback, overwrite, deletion or source cleanup.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, link, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isSafeAvatarStoragePath } from '../../src/lib/avatar-image.ts';
import { isSafeTweetImagePath } from '../../src/lib/tweet-image.ts';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const fail = () => { throw new Error('Image snapshot validation failed'); };

function safeKey(key) {
  if (typeof key !== 'string') fail();
  const slash = key.indexOf('/');
  const bucket = key.slice(0, slash), path = key.slice(slash + 1);
  if (slash < 0 || !(bucket === 'avatars' ? isSafeAvatarStoragePath(path)
    : ['tweet-images', 'note-images'].includes(bucket) && isSafeTweetImagePath(path))) fail();
  return key;
}

function privateEntry(info) {
  if (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid())) fail();
}

async function directory(path, create = false, leaf = false) {
  let info;
  try { info = await lstat(path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) return false;
    await mkdir(path, { mode: 0o700 });
    await syncDirectory(path);
    await syncDirectory(parse(path).dir);
    info = await lstat(path);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) fail();
  if (leaf) privateEntry(info);
  return true;
}

async function rootPath(root, create = false) {
  if (!isAbsolute(root) || resolve(root) !== root || root === parse(root).root) fail();
  let parent = parse(root).root;
  for (const part of root.slice(parent.length).split(sep).filter(Boolean)) {
    parent = join(parent, part);
    if (!await directory(parent, create, parent === root)) return false;
  }
  return true;
}

async function objectPath(root, key, create = false) {
  safeKey(key);
  if (!await rootPath(root, create)) return null;
  let parent = root;
  const parts = key.split('/');
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    if (!await directory(parent, create, true)) return null;
  }
  return join(parent, parts.at(-1));
}

async function hashFile(path, expected, copyTo) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat(), entry = await lstat(path);
    privateEntry(before);
    if (!before.isFile() || before.nlink !== 1 || entry.isSymbolicLink() || before.ino !== entry.ino ||
        before.dev !== entry.dev || before.size !== expected.bytes || before.size > MAX_IMAGE_BYTES) fail();
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > expected.bytes) fail();
      hash.update(chunk);
      if (copyTo) await copyTo.writeFile(chunk);
    }
    const after = await handle.stat();
    if (size !== expected.bytes || hash.digest('hex') !== expected.sha256 || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || before.size !== after.size) fail();
  } finally { await handle.close(); }
}

async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function inventory(root) {
  if (!await rootPath(root)) return new Map();
  const entries = new Map();
  async function walk(parent, prefix = '') {
    for (const item of await readdir(parent, { withFileTypes: true })) {
      const key = prefix + item.name, path = join(parent, item.name), info = await lstat(path);
      if (info.isSymbolicLink()) fail();
      privateEntry(info);
      if (info.isDirectory() && key.split('/').length < 3) await walk(path, key + '/');
      else if (info.isFile() && info.nlink === 1 && info.size <= MAX_IMAGE_BYTES) entries.set(safeKey(key), info.size);
      else fail();
    }
  }
  await walk(root);
  return entries;
}

export async function importImages({ manifest, sourceRoot, targetRoot, limit = 8_000_000_000, apply = false }) {
  if (manifest?.version !== 1 || typeof manifest.sourceId !== 'string' || !manifest.sourceId ||
      !Number.isFinite(Date.parse(manifest.snapshotAt)) || !Array.isArray(manifest.objects) ||
      !Array.isArray(manifest.requiredKeys) || !Number.isSafeInteger(limit) || limit <= 0) fail();
  // Data must stay outside the release and source; apply only to a private staging root.
  for (const ancestor of [sourceRoot, process.cwd()]) {
    const from = relative(ancestor, targetRoot);
    if (!from || (!from.startsWith(`..${sep}`) && from !== '..' && !isAbsolute(from))) fail();
  }
  if (!await rootPath(sourceRoot)) fail();
  const planned = new Map();
  for (const item of manifest.objects) {
    const key = safeKey(item.key);
    if (planned.has(key) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > MAX_IMAGE_BYTES ||
        typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) fail();
    planned.set(key, item);
  }
  const refs = new Set(manifest.requiredKeys.map(safeKey));
  if ([...refs].some(key => !planned.has(key))) fail();
  const current = await inventory(targetRoot);
  // Only this same complete snapshot may resume into a partially imported root.
  if ([...current.keys()].some(key => !planned.has(key))) fail();
  const bytes = [...planned.values()].reduce((sum, item) => sum + item.bytes, 0);
  if (!Number.isSafeInteger(bytes) || bytes > limit) fail();
  let existing = 0;
  for (const [key, item] of planned) {
    await hashFile(await objectPath(sourceRoot, key), item);
    if (current.has(key)) {
      await hashFile(await objectPath(targetRoot, key), item);
      existing++;
    }
  }
  if (apply) {
    await rootPath(targetRoot, true);
    for (const [key, item] of planned) {
      if (current.has(key)) continue;
      const path = await objectPath(targetRoot, key, true);
      const parent = parse(path).dir, temporary = join(parent, `.import-${randomUUID()}.tmp`);
      const output = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try {
        try { await hashFile(await objectPath(sourceRoot, key), item, output); await output.sync(); }
        finally { await output.close(); }
        await link(temporary, path); // Refuse replacement even if the destination appeared during capture.
        await unlink(temporary);
        await syncDirectory(parent);
        await syncDirectory(targetRoot);
        await hashFile(path, item);
      } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
    }
  }
  return { version: 1, dryRun: !apply, objects: planned.size, requiredObjects: refs.size, bytes, existing, copied: apply ? planned.size - existing : 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const flags = new Map();
    let apply = false;
    for (let i = 2; i < process.argv.length; i++) {
      const flag = process.argv[i];
      if (flag === '--apply' && !apply) { apply = true; continue; }
      if (!['--manifest', '--source', '--target', '--limit'].includes(flag) || flags.has(flag) || !process.argv[i + 1]) fail();
      flags.set(flag, process.argv[++i]);
    }
    const file = await open(flags.get('--manifest'), constants.O_RDONLY | constants.O_NOFOLLOW);
    let manifest;
    try {
      const info = await file.stat(); privateEntry(info);
      if (!info.isFile() || info.nlink !== 1 || info.size > 16 * 1024 * 1024) fail();
      manifest = JSON.parse(await file.readFile('utf8'));
    } finally { await file.close(); }
    console.log(JSON.stringify(await importImages({ manifest, sourceRoot: flags.get('--source'), targetRoot: flags.get('--target'), limit: flags.has('--limit') ? Number(flags.get('--limit')) : undefined, apply })));
  } catch { console.error('Image import failed; source and previously published images were preserved.'); process.exitCode = 1; }
}
