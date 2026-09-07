import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createServerClient } from '@supabase/ssr';
import { parse } from 'cookie';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const config = JSON.parse(readFileSync(resolve(root, '.contingency/private-trial.json'), 'utf8'));
const local = parseEnv(readFileSync(resolve(root, '.contingency/local-app.env'), 'utf8'));
// Production start normalizes Host to the actual local listener. Keep the
// HTTPS Origin check intact and emulate that Origin only for this HTTP rehearsal.
const origin = 'https://127.0.0.1:3010';
const request = (path, options = {}) => fetch('http://127.0.0.1:3010' + path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(30000) });
assert.equal((await request('/api/note-image')).status, 401);
const page = await request('/_pc/login');
assert.equal(page.status, 200);
assert.equal(page.headers.get('referrer-policy'), 'same-origin');
assert.equal((await request('/_pc/login', { method: 'POST', body: 'password=wrong', headers: { origin: 'https://evil.invalid' } })).status, 403);
const login = await request('/_pc/login', { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: config.password }) });
assert.equal(login.status, 303);
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const client = createServerClient(local.NEXT_PUBLIC_SUPABASE_URL, local.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookieOptions: { name: 'sb-pc-trial-auth' }, cookies: { getAll: () => Object.entries(parse(cookie)).map(([name, value]) => ({ name, value })), setAll: () => {} } });
const { data: { session } } = await client.auth.getSession();
assert.equal(session.user.id, config.userId);
const headers = { cookie, origin, apikey: local.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' };
for (const path of ['/home', '/timeline', '/notes', '/mypage']) {
  const response = await request(path, { headers: { cookie } });
  assert.equal(response.status, 200, path);
  assert.ok((await response.text()).includes('PC試験版'), path);
}
console.log('Preview configuration: login and four pages passed through the private PC bridge.');
const rest = '/_pc/supabase/rest/v1';
assert.equal((await request(rest + '/profiles?select=id&limit=1', { headers: { ...headers, authorization: `Bearer ${local.NEXT_PUBLIC_SUPABASE_ANON_KEY}` } })).status, 403);
assert.equal((await request('/api/push/test', { method: 'POST', headers, body: '{}' })).status, 403);
assert.equal((await request('/api/sheets/push-record', { method: 'POST', headers, body: '{}' })).status, 403);
const competitions = await (await request(rest + '/competitions?select=id&limit=1', { headers })).json();
const competitionId = competitions[0].id;
const events = await (await request(rest + '/competition_events?select=name&order=sort_order', { headers })).json();
const ownGoals = await (await request(rest + `/competition_goals?select=event&competition_id=eq.${competitionId}&user_id=eq.${config.userId}`, { headers })).json();
const event = events.find(item => !ownGoals.some(goal => goal.event === item.name));
assert.ok(event, 'Need an unused event; never overwrite a user goal');
let id;
try {
  const inserted = await request(rest + '/competition_goals', { method: 'POST', headers: { ...headers, prefer: 'return=representation' }, body: JSON.stringify({ competition_id: competitionId, user_id: config.userId, event: event.name, target: 'Preview接続確認（自動テスト）' }) });
  assert.equal(inserted.status, 201);
  id = (await inserted.json())[0].id;
  const updated = await request(rest + `/competition_goals?id=eq.${id}`, { method: 'PATCH', headers: { ...headers, prefer: 'return=representation' }, body: JSON.stringify({ target: 'Preview接続確認・更新（自動テスト）' }) });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json())[0].target, 'Preview接続確認・更新（自動テスト）');
} finally {
  if (id) {
    const removed = await request(rest + `/competition_goals?id=eq.${id}`, { method: 'DELETE', headers: { ...headers, prefer: 'return=representation' } });
    assert.equal(removed.status, 200);
    assert.equal((await removed.json())[0].id, id);
  }
}
const refresh = await request('/_pc/supabase/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers, body: JSON.stringify({ refresh_token: session.refresh_token }) });
assert.equal(refresh.status, 200);
assert.equal((await refresh.json()).user.id, config.userId);
assert.equal((await request('/_pc/logout', { method: 'POST', headers })).status, 303);
assert.equal((await request('/api/note-image', { headers: { cookie } })).status, 401);
console.log('Owner-only reads, goal insert/update/delete, refresh, logout, and external-operation blocks passed. Test goal removed. Vercel deployment is not part of this local verification.');
