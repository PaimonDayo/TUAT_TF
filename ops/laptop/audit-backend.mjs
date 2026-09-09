// Read-only production checks. Never prints credentials or member data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { directory, readConfig } from './backend-files.mjs';

const config = readConfig();
const base = 'https://tuat-tf.vercel.app/api/pc-supabase';
async function check(path, expected, init = {}) {
  const response = await fetch(base + path, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, expected, `${path.split('?')[0]} returned ${response.status}`);
  console.log(`${expected}: ${path.split('?')[0]}`);
  return response;
}
const settings = await (await check('/auth/v1/settings', 200)).json();
assert.equal(settings.external.google, true);
assert.equal(settings.disable_signup, true);
await check('/rest/v1/profiles?select=id&limit=1', 401);
await check('/auth/v1/admin/users', 403);
await check('/auth/v1/token?grant_type=refresh_token', 403, { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: '{}' });
const token = role => [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ role, sub: '11111111-1111-4111-8111-111111111111', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url'), Buffer.alloc(32).toString('base64url')].join('.');
await check('/rest/v1/profiles?select=id&limit=1', 401, { headers: { authorization: `Bearer ${token('authenticated')}` } });
await check('/rest/v1/profiles?select=id&limit=1', 401, { headers: { authorization: `Bearer ${token('service_role')}` } });
const status = JSON.parse(readFileSync(resolve(directory, 'runtime-status.json'), 'utf8'));
assert(Date.now() - Date.parse(status.checkedAt) < 120_000, 'Endpoint heartbeat is stale');
assert.match(status.origin, /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/);
const raw = await fetch(status.origin + '/health', { signal: AbortSignal.timeout(15_000) });
assert.equal(raw.status, 401, 'The tunnel must reject unauthenticated direct access');
const local = await fetch('http://127.0.0.1:3109/health', { headers: { 'x-pc-backend-key': config.bridgeKey }, signal: AbortSignal.timeout(5000) });
assert.equal((await local.json()).maintenance, false);
const backup = JSON.parse(readFileSync(resolve(directory, 'backup-status.json'), 'utf8'));
assert(Date.now() - Date.parse(backup.completedAt) < 35 * 60_000, 'Verified backup is stale');
console.log('Transport authentication, JWT rejection, Origin guard, fresh endpoint and backup verified.');
