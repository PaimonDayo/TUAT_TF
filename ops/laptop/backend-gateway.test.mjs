import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createBackendGateway } from './backend-gateway.mjs';
import { encryptBackup, decryptBackup } from './backup-backend.mjs';

test('backend requires transport key, preserves member authorization, strips secrets and freezes requests', async () => {
  const received = [];
  const api = http.createServer((req, res) => { received.push({ url: req.url, headers: req.headers }); res.setHeader('content-type', 'application/json'); res.end('{}'); });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  let maintenance = false;
  const key = 'test-only-'.repeat(8);
  const gateway = createBackendGateway({ key, instanceId: 'test', api: `http://127.0.0.1:${api.address().port}`, isMaintenance: () => maintenance });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const origin = `http://127.0.0.1:${gateway.address().port}`;
  try {
    assert.equal((await fetch(origin + '/backend/rest/v1/profiles')).status, 401);
    const headers = { 'x-pc-backend-key': key, authorization: 'Bearer member', cookie: 'must-not-leak=1' };
    assert.equal((await fetch(origin + '/backend/rest/v1/profiles', { headers })).status, 200);
    assert.equal(received[0].headers.authorization, 'Bearer member');
    assert.equal(received[0].headers.cookie, undefined);
    assert.equal(received[0].headers['x-pc-backend-key'], undefined);
    assert.equal((await fetch(origin + '/studio', { headers })).status, 403);
    assert.equal((await fetch(origin + '/backend/rest/v1/a%2Fb', { headers })).status, 400);
    maintenance = true;
    const unavailable = await fetch(origin + '/backend/rest/v1/profiles', { headers });
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.headers.get('content-type'), /charset=utf-8/i);
    assert.equal((await unavailable.json()).error, 'メンテナンス中です。少し待ってから再度お試しください。');
    assert.equal((await fetch(origin + '/health', { headers })).status, 200);
    assert.equal(received.length, 1);
  } finally { gateway.closeAllConnections(); api.closeAllConnections(); await Promise.all([new Promise(r => gateway.close(r)), new Promise(r => api.close(r))]); }
});

test('backup detects a wrong recovery key and altered ciphertext', () => {
  const key = 'ab'.repeat(32), bytes = Buffer.from('private database archive');
  const encrypted = encryptBackup(bytes, key);
  assert(decryptBackup(encrypted, key).equals(bytes));
  assert.throws(() => decryptBackup(encrypted, 'cd'.repeat(32)));
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decryptBackup(encrypted, key));
});
