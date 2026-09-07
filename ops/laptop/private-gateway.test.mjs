import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPrivateGateway } from './private-gateway.mjs';
const listen = s => new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(s.address().port)));
test('private gateway rejects anonymous, cross-origin, non-owner and external side effects', async () => {
  let hits = 0;
  const upstream = http.createServer((_req, res) => { hits++; res.end('private data'); });
  const port = await listen(upstream);
  const origin = 'https://owner-test.trycloudflare.com';
  const password = 'test-only-random-password-0123456789';
  const gateway = createPrivateGateway({ origin, password, userId: 'owner', email: 'owner@example.invalid', appUrl: `http://127.0.0.1:${port}`, apiUrl: `http://127.0.0.1:${port}` }, {
    authenticate: async () => ['sb-pc-trial-auth=fixture; Path=/; Secure'],
    validateUser: async token => token === 'owner-token',
  });
  const gatewayPort = await listen(gateway);
  const base = `http://127.0.0.1:${gatewayPort}`;
  const request = (path, opts = {}) => fetch(base + path, { redirect: 'manual', ...opts });
  try {
    for (const path of ['/home', '/api/note-image', '/_next/static/test.js', '/_pc/supabase/rest/v1/profiles']) assert.ok([303, 401].includes((await request(path)).status));
    assert.equal(hits, 0);
    const loginPage = await request('/_pc/login');
    assert.equal(loginPage.status, 200);
    assert.equal(loginPage.headers.get('referrer-policy'), 'same-origin', 'native form POSTs must retain their real Origin');
    for (const testOrigin of ['null', undefined]) {
      assert.equal((await request('/_pc/login', { method: 'POST', body: `password=${password}`, headers: testOrigin ? { origin: testOrigin } : {} })).status, 403);
    }
    assert.equal((await request('/_pc/login', { method: 'POST', body: `password=${password}`, headers: { origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await request('/_pc/login', { method: 'POST', body: 'password=wrong', headers: { origin } })).status, 401);
    const login = await request('/_pc/login', { method: 'POST', body: `password=${password}`, headers: { origin } });
    assert.equal(login.status, 303);
    const gate = login.headers.getSetCookie().find(c => c.startsWith('__Host-pc-trial='));
    assert.match(gate, /HttpOnly/); assert.match(gate, /Secure/); assert.match(gate, /SameSite=Lax/);
    const cookie = gate.split(';')[0];
    const home = await request('/home', { headers: { cookie } });
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('referrer-policy'), 'same-origin', 'logout and app forms need the same policy');
    assert.equal(hits, 1);
    assert.equal((await request('/api/google/connect', { headers: { cookie } })).status, 403);
    assert.equal((await request('/api/sheets/push-record', { method: 'POST', headers: { cookie, origin } })).status, 403);
    assert.equal((await request('/_pc/supabase/auth/v1/signup', { method: 'POST', headers: { cookie, origin } })).status, 403);
    assert.equal((await request('/_pc/supabase/storage/v1/object/test', { method: 'DELETE', headers: { cookie, origin } })).status, 403);
    assert.equal((await request('/_pc/supabase/rest/v1/profiles', { headers: { cookie, authorization: 'Bearer other-user' } })).status, 403);
    assert.equal((await request('/_pc/supabase/rest/v1/profiles', { headers: { cookie, authorization: 'Bearer owner-token' } })).status, 200);
    assert.equal((await request('/_pc/supabase/rest/v1/profiles', { method: 'POST', headers: { cookie, authorization: 'Bearer owner-token', origin: 'https://evil.invalid' } })).status, 403);
    assert.equal(hits, 2);
    assert.equal((await request('/_pc/supabase%2frest/v1/profiles', { headers: { cookie } })).status, 400);
    assert.equal((await request('/_pc/logout', { method: 'POST', headers: { cookie, origin } })).status, 303);
    assert.equal((await request('/api/test', { headers: { cookie } })).status, 401);
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    assert.equal((await new Promise(resolve => {
      const fresh = createPrivateGateway({ origin, password, userId: 'owner', email: 'owner@example.invalid' });
      fresh.listen(0, '127.0.0.1', async () => { const r = await fetch(`http://127.0.0.1:${fresh.address().port}/api/test`, { headers: { cookie } }); fresh.closeAllConnections(); fresh.close(); resolve(r.status); });
    })), 401, 'gateway restart invalidates old sessions');
  } finally { gateway.closeAllConnections(); gateway.close(); upstream.closeAllConnections(); upstream.close(); }
});
