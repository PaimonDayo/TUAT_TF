import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  hostStateDirectory: process.cwd(), backupStatusPath: resolve('backup-lifecycle.json'),
  expectedBackupInstanceId: '00000000-0000-4000-8000-000000000001', expectedBackupDatabaseSystemIdentifier: '1234567890123456789',
  environmentFile: process.cwd(), releaseCommit: 'a'.repeat(40), releaseId: 'pc-test-release',
  activateAt: new Date(now).toISOString(), appOrigin: 'http://127.0.0.1:3112', port: 3112 };
const records = (at = now, c = config) => {
  const timestamp = new Date(at).toISOString();
  const identity = { instanceId: c.expectedBackupInstanceId, generation: '00000000-0000-4000-8000-000000000002', startedAt: timestamp,
    databaseSystemIdentifier: c.expectedBackupDatabaseSystemIdentifier, databaseName: c.expectedBackupDatabaseName ?? 'postgres' };
  const key = `ops/pc-backend/${identity.instanceId}/backups/${timestamp.replaceAll(':', '-').replace('.', '-')}.dump.enc`;
  return {
    'runtime-status.json': { version: 1, running: true, releaseCommit: c.releaseCommit, releaseId: c.releaseId, startedAt: timestamp, checkedAt: timestamp, backup: { identity, statusPath: c.backupStatusPath } },
    'backup-lifecycle.json': { version: 1, ...identity, heartbeat: { checkedAt: timestamp, healthy: true, maintenance: false },
      target: { checkedAt: timestamp, healthy: true, databaseSystemIdentifier: identity.databaseSystemIdentifier, databaseName: identity.databaseName, containerId: 'a'.repeat(64), containerImageId: `sha256:${'b'.repeat(64)}` },
      backup: { generation: identity.generation, verifiedAt: timestamp, databaseSystemIdentifier: identity.databaseSystemIdentifier,
        key, recoveryKey: key.replace('.dump.enc', '.recovery.json.enc'), sha256: 'c'.repeat(64), recoverySha256: 'd'.repeat(64), bytes: 80, recoveryBytes: 90 } },
  };
};
const reader = data => file => JSON.stringify(data[file.split(/[\\/]/).at(-1)]);

test('check reports the configured enabled flag without dispatch, locks, or journal recovery', async t => {
  const directory = mkdtempSync(join(process.cwd(), '.tmp-shared-jobs-check-'));
  try {
    const c = { ...config, releaseDirectory:directory, stateDirectory:directory, environmentFile:join(directory,'synthetic.env') };
    mkdirSync(join(directory,'.next')); writeFileSync(join(directory,'.next','BUILD_ID'),'synthetic');
    writeFileSync(c.environmentFile,Object.entries(env).map(([key,value])=>`${key}=${value}`).join('\n'));
    const configFile = join(directory,'jobs.json');
    const journal = JSON.stringify({ preserved:'pending journal evidence', jobs:{program:{status:'uncertain'}} });
    writeFileSync(join(directory,'journal.json'),journal);
    writeFileSync(join(directory,'runner.lock'),'preserved owner');
    const names = readdirSync(directory).sort(), output=[];
    t.mock.method(console,'log',value=>output.push(JSON.parse(value)));
    const forbidden = () => { throw Error('Check must not execute, probe, acquire or recover a writer'); };
    for (const enabled of [false,true]) {
      writeFileSync(configFile,JSON.stringify({...c,enabled}));
      await run(configFile,false,{spawnProcess:forbidden,fetchRequest:forbidden,pause:forbidden});
      assert.equal(output.at(-1).valid,true);
      assert.equal(output.at(-1).enabled,enabled);
      assert.equal(readFileSync(join(directory,'journal.json'),'utf8'),journal);
      assert.equal(readFileSync(join(directory,'runner.lock'),'utf8'),'preserved owner');
      assert.deepEqual(readdirSync(directory).sort(),[...names,'jobs.json'].sort());
    }
  } finally { assert(directory.startsWith(process.cwd())); rmSync(directory,{recursive:true,force:true}); }
});

test('shared Jobs bind the native database name as well as its system identifier before probes', async () => {
  const native = { ...config, expectedBackupDatabaseName: 'tuat_pc_candidate' };
  assert.doesNotThrow(() => validateConfig(native, env));
  let probes = 0;
  const fetchRequest = async url => { probes++; return { ok: true, json: async () => url.endsWith('/api/version')
    ? { version: native.releaseCommit, releaseId: native.releaseId } : { swagger: '2.0' } }; };
  assert.equal(await sharedPcReady(native, env, { read: reader(records(now, native)), clock: () => now, fetchRequest }), true);
  assert.equal(probes, 2);
  for (const change of [
    data => { data['runtime-status.json'].backup.identity.databaseName = 'postgres'; },
    data => { data['runtime-status.json'].backup.identity.databaseName = 'postgres'; data['backup-lifecycle.json'].target.databaseName = 'postgres'; },
    data => { delete data['runtime-status.json'].backup.identity.databaseName; },
    data => { data['backup-lifecycle.json'].target.databaseName = 'postgres'; },
  ]) {
    const data = records(now, native); change(data); probes = 0;
    assert.equal(backendReady(native, { read: reader(data), now }), false);
    assert.equal(await sharedPcReady(native, env, { read: reader(data), clock: () => now, fetchRequest }), false);
    assert.equal(probes, 0); // No schema/version request and no Jobs dispatch for a different database.
  }
});

test('omitted database name preserves postgres and refuses a coherently different host database', () => {
  assert.doesNotThrow(() => validateConfig(config, env));
  const data = records();
  assert.equal(backendReady(config, { read: reader(data), now }), true);
  assert.equal(backendReady({ ...config, expectedBackupDatabaseName: 'postgres' }, { read: reader(data), now }), true);
  delete data['runtime-status.json'].backup.identity.databaseName;
  assert.equal(backendReady(config, { read: reader(data), now }), true);
  data['runtime-status.json'].backup.identity.databaseName = 'tuat_pc_candidate';
  data['backup-lifecycle.json'].target.databaseName = 'tuat_pc_candidate';
  assert.equal(backendReady(config, { read: reader(data), now }), false);
  for (const databaseName of ['', 'tuat-pc-candidate', 'POSTGRES', 'a'.repeat(64)]) {
    assert.throws(() => validateConfig({ ...config, expectedBackupDatabaseName: databaseName }, env));
  }
});

test('native local shared Jobs require one local issuer, private images and the same combined snapshot root',async()=>{
  const local={...env,PC_LOCAL_RUNTIME:'true',NEXT_PUBLIC_PC_LOCAL_RUNTIME:'true',PC_BACKEND_INTERNAL_URL:'',NEXT_PUBLIC_CLOUD_AUTH_URL:'',NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY:'',
    IMAGE_STORAGE_DRIVER:'local',LOCAL_IMAGE_STORAGE_ROOT:resolve('..','private-images'),LOCAL_IMAGE_SIGNING_KEY:'synthetic-local-signing'.repeat(3),PC_LOCAL_AUTH_URL:'http://127.0.0.1:18001',PC_LOCAL_REST_URL:'http://127.0.0.1:18002',
    R2_READ_ENABLED:'false',R2_WRITE_ENABLED:'false',R2_ACCOUNT_ID:'',R2_ACCESS_KEY_ID:'',R2_SECRET_ACCESS_KEY:'',R2_BUCKET_NAME:''};
  assert.doesNotThrow(()=>validateConfig(config,local));
  const data=records(),status=data['backup-lifecycle.json'],stamp=new Date(now).toISOString();
  const snapshot={format:'tuat-local-db-images-v1',sourceId:config.expectedBackupInstanceId,generation:status.generation,databaseSystemIdentifier:config.expectedBackupDatabaseSystemIdentifier,
    imageRoot:local.LOCAL_IMAGE_STORAGE_ROOT,archiveKey:`ops/pc-backend/${config.expectedBackupInstanceId}/backups/${stamp.replace(/[:.]/g,'-')}.local.tar.enc`,archiveSha256:'a'.repeat(64),archiveBytes:128,
    capturedAt:stamp,restoreVerifiedAt:stamp,offsiteVerifiedAt:stamp,independentRecoveryCopyChecked:true};
  status.backup={generation:status.generation,verifiedAt:stamp,key:snapshot.archiveKey,sha256:snapshot.archiveSha256,bytes:128,databaseSystemIdentifier:config.expectedBackupDatabaseSystemIdentifier,localSnapshot:snapshot};
  const fetchRequest=async (url,options)=>{
    if(url.endsWith('/api/version')){
      assert.equal(options.headers,undefined);
      return {ok:true,json:async()=>({version:config.releaseCommit,releaseId:config.releaseId})};
    }
    assert.equal(url,local.PC_LOCAL_REST_URL+'/');
    // The real local schema endpoint returned 401 for the anon credential.
    return {ok:options.headers.authorization===`Bearer ${local.SUPABASE_SERVICE_ROLE_KEY}`,
      json:async()=>({swagger:'2.0'})};
  };
  assert.equal(await sharedPcReady(config,local,{fetchRequest,read:reader(data),clock:()=>now}),true);
  status.backup.localSnapshot.imageRoot=resolve('..','wrong-images');
  assert.equal(await sharedPcReady(config,local,{fetchRequest,read:reader(data),clock:()=>now}),false);
  assert.throws(()=>validateConfig(config,{...local,NEXT_PUBLIC_CLOUD_AUTH_URL:env.NEXT_PUBLIC_CLOUD_AUTH_URL}));
});

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
  const changes = [ data => { data['backup-lifecycle.json'].heartbeat.maintenance = true; }, data => { data['runtime-status.json'].running = false; },
    data => { data['runtime-status.json'].checkedAt = new Date(now + 1).toISOString(); },
    data => { data['runtime-status.json'].checkedAt = new Date(now - 120000).toISOString(); },
    data => { data['backup-lifecycle.json'].backup.verifiedAt = new Date(now - 35 * 60000).toISOString(); },
    data => { data['backup-lifecycle.json'].generation = '00000000-0000-4000-8000-000000000003'; },
    data => { data['backup-lifecycle.json'].target.databaseSystemIdentifier = '9876543210987654321'; data['backup-lifecycle.json'].backup.databaseSystemIdentifier = '9876543210987654321'; },
    data => { data['backup-lifecycle.json'].backup = null; },
    data => { data['runtime-status.json'].releaseId = 'wrong'; },
    data => { data['runtime-status.json'].backup.statusPath = resolve('different-private-file.json'); },
  ];
  for (const change of changes) { const data = records(); change(data); assert.equal(backendReady(config, { read: reader(data), now }), false); }
  assert.equal(backendReady(config, { read: () => { throw Error('Unknown status'); }, now }), false);
});

test('shared readiness pins SHA and release ID and probes schema without real rows or service keys', async () => {
  const seen = [];
  const fetchRequest = async (url, options) => {
    seen.push({ url, options });
    return { ok: true, json: async () => url.endsWith('/api/version') ? { version: config.releaseCommit, releaseId: config.releaseId } : { swagger: '2.0' } };
  };
  assert.equal(await sharedPcReady(config, env, { read: reader(records()), clock: () => now, fetchRequest }), true);
  assert.deepEqual(seen.map(value => value.url), ['http://127.0.0.1:3112/api/version', 'http://127.0.0.1:8000/rest/v1/']);
  assert(seen.every(value => value.options.redirect === 'error'));
  assert(!JSON.stringify(seen).includes(env.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal(await sharedPcReady(config, env, { read: reader(records()), clock: () => now, fetchRequest: async () => ({ ok: true, json: async () => ({ version: 'b'.repeat(40), releaseId: config.releaseId }) }) }), false);
});

test('readiness resamples the clock after probes for newly written and newly expired heartbeats', async () => {
  for (const stale of [false, true]) {
    let at = now;
    const data = records(stale ? now - 119_000 : now);
    const fetchRequest = async url => {
      at = now + 3_000;
      if (!stale) {
        data['runtime-status.json'].checkedAt = new Date(at).toISOString();
        data['backup-lifecycle.json'].heartbeat.checkedAt = new Date(at).toISOString();
        data['backup-lifecycle.json'].target.checkedAt = new Date(at).toISOString();
      }
      return { ok: true, json: async () => url.endsWith('/api/version') ? { version: config.releaseCommit, releaseId: config.releaseId } : { swagger: '2.0' } };
    };
    assert.equal(await sharedPcReady(config, env, { read: reader(data), clock: () => at, fetchRequest }), !stale);
  }
});

test('shared runner reuses app, preserves journal, and disabling during a late probe dispatches nothing', async () => {
  const directory = mkdtempSync(join(process.cwd(), '.tmp-shared-jobs-'));
  try {
    const c = { ...config, enabled: true, releaseDirectory: directory, stateDirectory: directory, hostStateDirectory: directory, backupStatusPath: join(directory, 'backup-lifecycle.json'),
      environmentFile: join(directory, 'synthetic.env'), activateAt: new Date(Date.now() - 86400000).toISOString() };
    mkdirSync(join(directory, '.next')); writeFileSync(join(directory, '.next', 'BUILD_ID'), 'synthetic');
    writeFileSync(c.environmentFile, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'));
    for (const [name, value] of Object.entries(records(Date.now(), c))) writeFileSync(join(directory, name), JSON.stringify(value));
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
