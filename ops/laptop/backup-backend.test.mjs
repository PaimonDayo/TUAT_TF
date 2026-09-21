import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encryptBackup, decryptBackup, verifyRecovery, downloadRecovery } from './backup-backend.mjs';

const key = '11'.repeat(32);
const dump = Buffer.from('PGDMP synthetic database');
const instance = '11111111-1111-4111-8111-111111111111';
const recovery = { version: 1, instanceId: instance, databaseDumpSha256: createHash('sha256').update(dump).digest('hex'), vault: [{ name: 'fictional', secret: 'test-only' }], pushEnv: 'TEST_ONLY=value', cron: { installed: false, jobs: [] } };
const bytes = Buffer.from(JSON.stringify(recovery));

test('encrypted recovery round trip preserves settings and detects tampering', () => {
  const encrypted = encryptBackup(bytes, key);
  assert.deepEqual(verifyRecovery(decryptBackup(encrypted, key), dump, instance), recovery);
  assert.equal(encrypted.includes(Buffer.from('test-only')), false);
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decryptBackup(encrypted, key));
});
test('recovery cannot be paired with a different database or instance', () => {
  assert.throws(() => verifyRecovery(bytes, Buffer.from('PGDMP different'), instance));
  assert.throws(() => verifyRecovery(bytes, dump, 'different-instance'));
  for (const change of [{ version: 2 }, { vault: null }, { cron: { jobs: [] } }, { pushEnv: {} }]) {
    assert.throws(() => verifyRecovery(Buffer.from(JSON.stringify({ ...recovery, ...change })), dump, instance));
  }
});
test('recovery download validates ownership, checksum and authenticated content', async () => {
  const encrypted = encryptBackup(bytes, key);
  const metadata = { sha256: createHash('sha256').update(encrypted).digest('hex') };
  let calls = 0;
  const client = { async send() { calls++; return { Metadata: metadata, Body: { transformToByteArray: async () => encrypted } }; } };
  const objectKey = `ops/pc-backend/${instance}/backups/fictional.recovery.json.enc`;
  await assert.rejects(downloadRecovery(client, 'test-only', 'other/secret.recovery.json.enc', key, dump, instance));
  assert.equal(calls, 0);
  assert.deepEqual(await downloadRecovery(client, 'test-only', objectKey, key, dump, instance), bytes);
  metadata.sha256 = 'invalid';
  await assert.rejects(downloadRecovery(client, 'test-only', objectKey, key, dump, instance));
});
