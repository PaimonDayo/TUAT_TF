import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile, symlink, link, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { encryptBackupStream, decryptBackupFile } from './backup-codec.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'codec-check-'));
  const key = join(root, 'key');
  await writeFile(key, randomBytes(32), { mode: 0o600 });
  try { await run({ root, key, archive: join(root, 'archive.enc'), target: join(root, 'restored') }); }
  finally { await rm(root, { recursive: true }); }
}

test('private key rejects symlink, hardlink, wrong length and public mode without publication', async () => {
  await fixture(async ({ root, key }) => {
    const linked = join(root, 'linked'); await symlink(key, linked);
    const short = join(root, 'short'); await writeFile(short, randomBytes(31), { mode: 0o600 });
    const publicKey = join(root, 'public'); await writeFile(publicKey, randomBytes(32), { mode: 0o644 });
    const hard = join(root, 'hard'); await link(key, hard);
    for (const [i, candidate] of [linked, short, publicKey, hard].entries()) {
      await assert.rejects(encryptBackupStream(Readable.from([Buffer.from('synthetic')]), join(root, 'reject' + i), candidate));
    }
    assert.equal((await readdir(root)).some(name => name.startsWith('reject') || name.includes('.partial-')), false);
  });
});

test('backup and authenticated restoration refuse overwriting existing files', async () => {
  await fixture(async ({ key, archive, target }) => {
    const payload = Buffer.from('synthetic immutable archive');
    await encryptBackupStream(Readable.from([payload]), archive, key);
    const original = await readFile(archive);
    await assert.rejects(encryptBackupStream(Readable.from([Buffer.from('replacement')]), archive, key));
    assert.deepEqual(await readFile(archive), original);
    await decryptBackupFile(archive, target, key);
    await assert.rejects(decryptBackupFile(archive, target, key));
    assert.deepEqual(await readFile(target), payload);
  });
});

test('cipher source symlink is refused and tampered stream leaves no plaintext or staging', async () => {
  await fixture(async ({ root, key, archive, target }) => {
    await encryptBackupStream(Readable.from([Buffer.from('synthetic authenticated data')]), archive, key);
    const alias = join(root, 'alias'); await symlink(archive, alias);
    await assert.rejects(decryptBackupFile(alias, target, key));
    const bytes = await readFile(archive); bytes[40] ^= 1; await writeFile(archive, bytes);
    await assert.rejects(decryptBackupFile(archive, target, key));
    assert.equal((await readdir(root)).some(name => name === 'restored' || name.includes('.partial-')), false);
  });
});
