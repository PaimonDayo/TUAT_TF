// TUATPC01 framing matches ops/laptop/backup-backend.mjs; no provider dependency.
// Restore decrypts into private staging and publishes only after GCM authentication.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { open, lstat, link, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAGIC = Buffer.from('TUATPC01');
const MAX_BYTES = 16 * 1024 ** 3;

async function keyFrom(path) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await fd.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size !== 32 ||
        (info.mode & 0o077) || info.uid !== process.getuid()) throw Error('Invalid private recovery key');
    const key = await fd.readFile();
    if (key.length !== 32) { key.fill(0); throw Error('Invalid private recovery key'); }
    return key;
  } finally { await fd.close(); }
}

async function syncParent(path) {
  const fd = await open(dirname(resolve(path)), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await fd.sync(); } finally { await fd.close(); }
}

async function privateParent(path) {
  const info = await lstat(dirname(resolve(path)));
  if (!info.isDirectory() || (info.mode & 0o077) || info.uid !== process.getuid()) {
    throw Error('Private output directory required');
  }
}

async function writeAll(fd, bytes, position = null) {
  let offset = 0;
  while (offset < bytes.length) {
    const wrote = await fd.write(bytes, offset, bytes.length - offset,
      position === null ? null : position + offset);
    if (!wrote.bytesWritten) throw Error('Incomplete backup write');
    offset += wrote.bytesWritten;
  }
}

export async function encryptBackupStream(input, destination, keyPath) {
  await privateParent(destination);
  const key = await keyFrom(keyPath);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const temporary = destination + '.partial-' + randomBytes(8).toString('hex');
  let fd;
  let size = 0;
  try {
    fd = await open(temporary, 'wx', 0o600);
    await writeAll(fd, Buffer.concat([MAGIC, iv, Buffer.alloc(16)]));
    for await (const chunk of input) {
      size += chunk.length;
      if (size > MAX_BYTES) throw Error('Backup exceeds bound');
      await writeAll(fd, cipher.update(chunk));
    }
    await writeAll(fd, cipher.final());
    await writeAll(fd, cipher.getAuthTag(), 20);
    await fd.sync();
    await fd.close(); fd = undefined;
    await link(temporary, destination); // Immutable publication; refuses existing backup.
    await syncParent(destination);
    return { plaintextBytes: size, encryptedBytes: size + 36 };
  } finally {
    key.fill(0);
    await fd?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await syncParent(destination);
  }
}

export async function decryptBackupFile(source, destination, keyPath) {
  await privateParent(destination);
  const key = await keyFrom(keyPath);
  let sourceFd;
  const header = Buffer.alloc(36);
  let fd;
  const temporary = destination + '.partial-' + randomBytes(8).toString('hex');
  try {
    sourceFd = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await sourceFd.stat();
    if (!info.isFile() || info.size < 36 || info.size > MAX_BYTES + 36) throw Error('Invalid backup bounds');
    const read = await sourceFd.read(header, 0, 36, 0);
    if (read.bytesRead !== 36 || !header.subarray(0, 8).equals(MAGIC)) throw Error('Invalid backup format');
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8, 20));
    decipher.setAuthTag(header.subarray(20, 36));
    fd = await open(temporary, 'wx', 0o600);
    let ciphertextBytes = 0;
    for await (const chunk of sourceFd.createReadStream({ start: 36, autoClose: false })) {
      ciphertextBytes += chunk.length;
      if (ciphertextBytes > MAX_BYTES) throw Error('Backup exceeds bound');
      await writeAll(fd, decipher.update(chunk));
    }
    await writeAll(fd, decipher.final()); // Never publish plaintext unless this authenticates.
    await fd.sync();
    await fd.close(); fd = undefined;
    await link(temporary, destination);
    await syncParent(destination);
    return { authenticated: true };
  } finally {
    key.fill(0);
    await fd?.close();
    await sourceFd?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await syncParent(destination);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, input, output, key] = process.argv.slice(2);
    if (mode === 'generate-key' && input && !output) {
      await privateParent(input);
      const fd = await open(input, 'wx', 0o600);
      try { await writeAll(fd, randomBytes(32)); await fd.sync(); } finally { await fd.close(); }
    } else if (mode === 'encrypt' && input && output && key) {
      await encryptBackupStream(input === '-' ? process.stdin : createReadStream(input), output, key);
    } else if (mode === 'decrypt' && input && output && key) {
      await decryptBackupFile(input, output, key);
    } else throw Error('Invalid backup command');
    console.log(JSON.stringify({ ok: true, operation: mode }));
  } catch {
    console.error('Backup operation failed; authentication failures publish no restored output.');
    process.exitCode = 1;
  }
}
