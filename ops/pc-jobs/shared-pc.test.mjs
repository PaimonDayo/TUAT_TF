import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { validateConfig, run } from './run.mjs';
import { loopbackRoot, backendReady, sharedPcReady } from './shared-pc.mjs';

const now = Date.parse('2026-10-11T04:00:00Z');
const env = {
  PC_APP_RUNTIME: 'true', NEXT_PUBLIC_PC_APP_RUNTIME: 'true', PC_BACKEND_ENABLED: 'true', NEXT_PUBLIC_PC_BACKEND: 'true',
  PC_BACKEND_INTERNAL_URL: 'http://127.0.0.1:8000', APP_PUBLIC_ORIGIN: 'https://candidate.example',
  NEXT_PUBLIC_SUPABASE_URL: 'https://candidate.example/api/pc-supabase', PC_APP_RELEASE_ID: 'pc-test-release',
  NEXT_PUBLIC_CLOUD_AUTH_URL: 'https://syntheticauth.supabase.co', NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY: 'synthetic-cloud-anon',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-pc-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-pc-service',
  CRON_SECRET: 'synthetic-cron', SHEET_SYNC_SECRET: 'synthetic-sheet', SHEET_SYNC_ENABLED: 'true', SHEET_SYNC_GAS_URL: 'https://script.google.com/synthetic',
  R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'synthetic-r2', R2_SECRET_ACCESS_KEY: 'synthetic-r2-secret', R2_BUCKET_NAME: 'synthetic-r2-bucket',
  R2_READ_ENABLED: 'true', R2_WRITE_ENABLED: 'true',
};
const config = { version: 1, enabled: false, runtime: 'shared-pc', releaseDirectory: process.cwd(), stateDirectory: process.cwd(),
  backendDirectory: process.cwd(), environmentFile: process.cwd(), releaseCommit: 'a'.repeat(40), releaseId: 'pc-test-release',
  activateAt: new Date(now).toISOString(), appOrigin: 'http://127.0.0.1:3112', port: 3112 };
const records = () => ({ 'config.json': { maintenance: false }, 'runtime-status.json': { healthy: true, maintenance: false, checkedAt: new Date(now).toISOString() },
  'backup-status.json': { completedAt: new Date(now).toISOString() } });
const reader = data => file => JSON.stringify(data[file.split(/[\\/]/).at(-1)]);

test('shared PC mode preserves cloud Auth and private R2; dedicated remains default', () => {
  assert.doesNotThrow(() => validateConfig(config, env));
  for (const altered of [ { ...env, PC_BACKEND_INTERNAL_URL: 'https://public.example' }, { ...env, IMAGE_STORAGE_DRIVER: 'local' },
    { ...env, NEXT_PUBLIC_CLOUD_AUTH_URL: '' }, { ...env, NEXT_PUBLIC_PC_APP_RUNTIME: 'false' }, { ...env, R2_WRITE_ENABLED: 'false' } ]) {
    assert.throws(() => validateConfig(config, altered));
  }
  assert.throws(() => validateConfig({ ...config, runtime: 'shared-local' }, env));
  assert.throws(() => validateConfig({ ...config, runtime: undefined }, env)); // existing dedicated cloud rejection
});

test('shared origin refuses public URLs, redirect paths, credentials and ambiguous ports', () => {
  assert.equal(loopbackRoot('http://127.0.0.1:3112'), 'http://127.0.0.1:3112');
  for (const value of ['http://localhost:3112', 'https://127.0.0.1:3112', 'http://127.0.0.1:3112/', 'http://127.0.0.1:3112?a=1',
    'http://user@127.0.0.1:3112', 'http://127.0.0.1:80', 'http://127.0.0.1:65536', 'http://127.0.0.1:03112']) assert.throws(() => loopbackRoot(value));
});

test('maintenance, stale/future heartbeat and backup prevent writes', () => {
  assert.equal(backendReady(config, { read: reader(records()), now }), true);
  const changes = [ data => { data['config.json'].maintenance = true; }, data => { data['config.json'].returnAt = 'invalid'; },
    data => { data['runtime-status.json'].checkedAt = new Date(now + 1).toISOString(); },
    data => { data['runtime-status.json'].checkedAt = new Date(now - 120000).toISOString(); },
    data => { data['backup-status.json'].completedAt = new Date(now - 35 * 60000).toISOString(); } ];
  for (const change of changes) { const data = records(); change(data); assert.equal(backendReady(config, { read: reader(data), now }), false); }
});

test('shared readiness pins SHA and release ID and probes schema without real rows or service keys', async () => {
  const seen = [];
  const fetchRequest = async (url, options) => {
    seen.push({ url, options });
    return { ok: true, json: async () => url.endsWith('/api/version') ? { version: config.releaseCommit, releaseId: config.releaseId } : { swagger: '2.0' } };
  };
  assert.equal(await sharedPcReady(config, env, { read: reader(records()), now, fetchRequest }), true);
  assert.deepEqual(seen.map(value => value.url), ['http://127.0.0.1:3112/api/version', 'http://127.0.0.1:8000/rest/v1/']);
  assert(seen.every(value => value.options.redirect === 'error'));
  assert(!JSON.stringify(seen).includes(env.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal(await sharedPcReady(config, env, { read: reader(records()), now, fetchRequest: async () => ({ ok: true, json: async () => ({ version: 'b'.repeat(40), releaseId: config.releaseId }) }) }), false);
});

test('shared runner reuses app, preserves journal, and disabling during a late probe dispatches nothing', async () => {
  const directory = mkdtempSync(join(process.cwd(), '.tmp-shared-jobs-'));
  try {
    const c = { ...config, enabled: true, releaseDirectory: directory, stateDirectory: directory, backendDirectory: directory,
      environmentFile: join(directory, 'synthetic.env'), activateAt: new Date(Date.now() - 86400000).toISOString() };
    mkdirSync(join(directory, '.next')); writeFileSync(join(directory, '.next', 'BUILD_ID'), 'synthetic');
    writeFileSync(c.environmentFile, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'));
    for (const [name, value] of Object.entries(records())) writeFileSync(join(directory, name), JSON.stringify({ ...value,
      ...(name === 'runtime-status.json' ? { checkedAt: new Date().toISOString() } : name === 'backup-status.json' ? { completedAt: new Date().toISOString() } : {}) }));
    const configFile = join(directory, 'jobs.json'); writeFileSync(configFile, JSON.stringify(c));
    let spawned = 0, dispatched = 0;
    await run(configFile, true, { spawnProcess: () => { spawned++; throw Error('must reuse app'); },
      fetchRequest: async url => {
        if (url.endsWith('/api/version')) writeFileSync(configFile, JSON.stringify({ ...c, enabled: false }));
        if (!url.endsWith('/api/version') && !url.endsWith('/rest/v1/')) dispatched++;
        return { ok: true, json: async () => url.endsWith('/api/version') ? { version: c.releaseCommit, releaseId: c.releaseId } : { swagger: '2.0' } };
      } });
    assert.equal(spawned, 0); assert.equal(dispatched, 0);
    const state = JSON.parse(readFileSync(join(directory, 'journal.json'), 'utf8'));
    assert.deepEqual(state.jobs, {});
  } finally { assert(directory.startsWith(process.cwd())); rmSync(directory, { recursive: true, force: true }); }
});
