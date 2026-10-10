import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createSyntheticPair, generateFixture, rejectExternalCredentials, verifyPrivateState, verifyToken } from './synthetic-review.mjs';

test('check is the default and does not start listeners or write keys', () => {
  const child = spawnSync(process.execPath, ['ops/pc-host/synthetic-review.mjs'], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  const result = JSON.parse(child.stdout);
  assert.equal(result.mode, 'check'); assert.equal(result.startsListeners, false); assert.equal(result.writesKeys, false);
});
test('inherited credentials are rejected without reading their values', () => {
  const env = {};
  Object.defineProperty(env, 'SUPABASE_SERVICE_ROLE_KEY', { enumerable: true, get() { throw Error('Secret must not be read'); } });
  assert.throws(() => rejectExternalCredentials(env), /Inherited provider credentials/);
  assert.doesNotThrow(() => rejectExternalCredentials({ PATH: 'fixture-only' }));
  assert.throws(() => verifyPrivateState('relative-path'), /private absolute/);
});
test('tokens require the exact HMAC, issuer and future expiry', () => {
  const fixture = generateFixture();
  const token = fixture.manifest.sessions.member.access_token;
  assert.equal(verifyToken(token, fixture.authSecret, fixture.manifest.authOrigin)?.sub, fixture.manifest.users.member.id);
  assert.equal(verifyToken(token, fixture.pcSecret, fixture.manifest.authOrigin), null);
  assert.equal(verifyToken(token, fixture.authSecret, fixture.manifest.pcOrigin), null);
  assert.equal(verifyToken(token, fixture.authSecret, fixture.manifest.authOrigin, Math.floor(Date.now() / 1000) + 7200), null);
  assert.equal(verifyToken('invalid', fixture.authSecret, fixture.manifest.authOrigin), null);
});
test('bounded loopback Auth and REST fixtures enforce identity and remain independent when PC is down', async () => {
  const fixture = generateFixture(), pair = createSyntheticPair(fixture), { manifest } = fixture;
  await pair.listen();
  const authHeaders = { apikey: manifest.keys.cloudAnon, authorization: `Bearer ${manifest.sessions.member.access_token}` };
  const pcHeaders = { apikey: manifest.keys.pcAnon, authorization: `Bearer ${manifest.sessions.member.access_token}` };
  const profileUrl = `${manifest.pcOrigin}/rest/v1/profiles?id=eq.${manifest.users.member.id}`;
  try {
    const user = await fetch(`${manifest.authOrigin}/auth/v1/user`, { headers: authHeaders });
    assert.equal(user.status, 200); assert.equal((await user.json()).id, manifest.users.member.id);
    const tampered = `${manifest.sessions.member.access_token.slice(0, -1)}!`;
    assert.equal((await fetch(`${manifest.authOrigin}/auth/v1/user`, { headers: { ...authHeaders, authorization: `Bearer ${tampered}` } })).status, 401);
    assert.equal((await fetch(profileUrl, { headers: { ...pcHeaders, apikey: 'unrecognized' } })).status, 401);
    assert.equal((await fetch(profileUrl, { headers: { ...pcHeaders, authorization: `Bearer ${manifest.keys.pcAnon}` } })).status, 401);
    const own = await fetch(profileUrl, { headers: pcHeaders });
    assert.equal(own.status, 200); assert.equal((await own.json())[0].id, manifest.users.member.id);
    const other = await fetch(`${manifest.pcOrigin}/rest/v1/profiles?id=eq.${manifest.users.external.id}`, { headers: pcHeaders });
    assert.equal(other.status, 200); assert.deepEqual(await other.json(), []);
    assert.equal((await fetch(`${manifest.pcOrigin}/rest/v1/unimplemented_table`, { headers: pcHeaders })).status, 404);
    const adminUrl = `${manifest.pcOrigin}/auth/v1/admin/users/${manifest.users.member.id}`;
    assert.equal((await fetch(adminUrl, { headers: pcHeaders })).status, 403);
    const admin = await fetch(adminUrl, { headers: { apikey: manifest.keys.pcServiceRole, authorization: `Bearer ${manifest.keys.pcServiceRole}` } });
    assert.equal(admin.status, 200); assert.equal((await admin.json()).user.id, manifest.users.member.id);
    const denied = await fetch(profileUrl, { method: 'PATCH', headers: { ...pcHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ approved: false }) });
    assert.equal(denied.status, 403);
    const oversized = await fetch(profileUrl, { method: 'PATCH', headers: { ...pcHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'x'.repeat(64 * 1024) }) });
    assert.equal(oversized.status, 413);
    const refresh = await fetch(`${manifest.authOrigin}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: manifest.keys.cloudAnon, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: manifest.sessions.member.refresh_token }) });
    assert.equal(refresh.status, 200); assert.equal((await refresh.json()).user.id, manifest.users.member.id);
    const pkceRequest = { method: 'POST', headers: { apikey: manifest.keys.cloudAnon, 'content-type': 'application/json' }, body: JSON.stringify({ auth_code: manifest.pkce.code, code_verifier: manifest.pkce.verifier }) };
    assert.equal((await fetch(`${manifest.authOrigin}/auth/v1/token?grant_type=pkce`, pkceRequest)).status, 200);
    assert.equal((await fetch(`${manifest.authOrigin}/auth/v1/token?grant_type=pkce`, pkceRequest)).status, 400);
    const before = pair.status().counters.cloudRestRejected;
    pair.setPcAvailable(false);
    assert.equal((await fetch(profileUrl, { headers: pcHeaders })).status, 503);
    assert.equal((await fetch(`${manifest.authOrigin}/auth/v1/user`, { headers: authHeaders })).status, 200);
    assert.equal(pair.status().counters.cloudRestRejected, before);
    pair.setPcAvailable(true);
    assert.equal((await fetch(profileUrl, { headers: pcHeaders })).status, 200);
    const cloudData = await fetch(`${manifest.authOrigin}/rest/v1/profiles`, { headers: authHeaders });
    assert.equal(cloudData.status, 403);
    assert.equal(pair.status().counters.cloudRestRejected, before + 1);
    assert.equal(Object.keys(pair.status()).includes('keys'), false);
  } finally { await pair.close(); }
});
test('cleanup closes only the pair it owns', async () => {
  const unrelated = http.createServer((_req, res) => res.end('unrelated'));
  await new Promise(resolve => unrelated.listen(0, '127.0.0.1', resolve));
  const pair = createSyntheticPair();
  try {
    await pair.listen(); await pair.close();
    assert.equal(unrelated.listening, true);
    assert.equal(await (await fetch(`http://127.0.0.1:${unrelated.address().port}`)).text(), 'unrelated');
  } finally { unrelated.closeAllConnections(); await new Promise(resolve => unrelated.close(resolve)); await pair.close(); }
});
