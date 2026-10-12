import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, symlink, link, chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { importImages } from './import-images.mjs';

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'tuat-image-import-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const sourceRoot = join(parent, 'source'), targetRoot = join(parent, 'target');
  await mkdir(sourceRoot, { mode: 0o700 });
  const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 18, g: 53, b: 97 } } }).webp().toBuffer();
  const keys = ['avatars/fake-user/avatar.webp', 'tweet-images/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp', 'note-images/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.webp'];
  for (const key of keys) {
    await mkdir(join(sourceRoot, key, '..'), { recursive: true, mode: 0o700 });
    await writeFile(join(sourceRoot, key), webp, { mode: 0o600 });
  }
  const manifest = { version: 1, sourceId: 'synthetic-images', snapshotAt: '2026-10-09T20:33:00Z', requiredKeys: keys, objects: keys.map(key => ({ key, bytes: webp.length, sha256: createHash('sha256').update(webp).digest('hex') })) };
  return { manifest, sourceRoot, targetRoot, webp };
}

test('dryRun checks all references and bytes without creating a destination; apply preserves paths/WebP and safely resumes', async t => {
  const f = await fixture(t);
  const before = await importImages(f);
  assert.equal(before.dryRun, true); assert.equal(before.copied, 0); assert.equal(before.requiredObjects, 3);
  await assert.rejects(lstat(f.targetRoot), { code: 'ENOENT' });
  assert.equal((await importImages({ ...f, apply: true })).copied, 3);
  for (const { key } of f.manifest.objects) {
    const bytes = await readFile(join(f.targetRoot, key));
    assert.deepEqual(bytes, f.webp);
    assert.equal((await sharp(bytes).metadata()).format, 'webp');
    const stat = await lstat(join(f.targetRoot, key));
    assert.equal(stat.nlink, 1); assert.equal(stat.mode & 0o777, 0o600);
  }
  const resumed = await importImages({ ...f, apply: true });
  assert.equal(resumed.existing, 3); assert.equal(resumed.copied, 0);
});

test('missing reference, incomplete source and checksum mismatch fail before destination writes', async t => {
  const f = await fixture(t);
  await assert.rejects(importImages({ ...f, manifest: { ...f.manifest, requiredKeys: [...f.manifest.requiredKeys, 'avatars/missing/avatar.webp'] }, apply: true }));
  await writeFile(join(f.sourceRoot, f.manifest.objects[1].key), Buffer.alloc(f.webp.length), { mode: 0o600 });
  await assert.rejects(importImages({ ...f, apply: true }));
  await assert.rejects(lstat(f.targetRoot), { code: 'ENOENT' });
  await rm(join(f.sourceRoot, f.manifest.objects[0].key));
  await assert.rejects(importImages(f));
});

test('capacity and duplicate/unsafe paths are refused without publication', async t => {
  const f = await fixture(t);
  await assert.rejects(importImages({ ...f, limit: f.webp.length, apply: true }));
  await assert.rejects(importImages({ ...f, manifest: { ...f.manifest, objects: [...f.manifest.objects, f.manifest.objects[0]] } }));
  await assert.rejects(importImages({ ...f, manifest: { ...f.manifest, objects: [{ ...f.manifest.objects[0], key: 'avatars/../../escape.webp' }] } }));
  await assert.rejects(lstat(f.targetRoot), { code: 'ENOENT' });
});

test('conflicting destination is preserved and unrelated destination objects are never deleted', async t => {
  const f = await fixture(t);
  await importImages({ ...f, apply: true });
  const destination = join(f.targetRoot, f.manifest.objects[0].key);
  const conflict = Buffer.alloc(f.webp.length, 4);
  await writeFile(destination, conflict);
  await assert.rejects(importImages({ ...f, apply: true }));
  assert.deepEqual(await readFile(destination), conflict);
  await writeFile(destination, f.webp);
  const extra = join(f.targetRoot, 'avatars/fake-user/orphan.webp');
  await writeFile(extra, f.webp, { mode: 0o600 });
  await assert.rejects(importImages({ ...f, apply: true }));
  assert.deepEqual(await readFile(extra), f.webp);
});

test('symlinked ancestors/objects and hardlinked source images are refused', async t => {
  const f = await fixture(t);
  const linkedRoot = join(f.sourceRoot, '..', 'linked');
  await symlink(f.sourceRoot, linkedRoot, 'dir');
  await assert.rejects(importImages({ ...f, sourceRoot: linkedRoot }));
  const source = join(f.sourceRoot, f.manifest.objects[0].key);
  const renamed = join(f.sourceRoot, 'actual.webp');
  await writeFile(renamed, f.webp, { mode: 0o600 });
  await rm(source); await symlink(renamed, source);
  await assert.rejects(importImages(f));
  await rm(source); await link(renamed, source);
  await assert.rejects(importImages(f));
});

test('public permissions, release-local roots and source-contained targets are refused', async t => {
  const f = await fixture(t);
  await assert.rejects(importImages({ ...f, targetRoot: join(process.cwd(), 'public', 'images') }));
  await assert.rejects(importImages({ ...f, targetRoot: join(f.sourceRoot, 'target') }));
  await chmod(join(f.sourceRoot, f.manifest.objects[0].key), 0o644);
  await assert.rejects(importImages({ ...f, apply: true }));
  assert.deepEqual(await readdir(join(f.sourceRoot, '..')), ['source']);
});
