// Synthetic owned Next process only; no WSL, database, provider, task, or real backup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import http from 'node:http';
import { run } from './run.mjs';
import { privateDirectory, sourceProof, buildHash, environmentHash, writeReceipt } from './release.mjs';
import { createRuntimeManifest, hostGitPath } from './runtime-manifest.mjs';
import { MIN_MAX_PAIR_BYTES } from '../pc-backup/config.mjs';

async function unusedPort() {
  const server = http.createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
async function waitUntil(condition) {
  const deadline = Date.now() + 10_000;
  while (!condition() && Date.now() < deadline) await new Promise(done => setTimeout(done, 20));
  assert.ok(condition(), 'owned synthetic process did not reach the expected state');
}
async function fixture(t) {
  const parent = resolve('.contingency'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'host-backup-lifecycle-'));
  t.after(() => { const path = relative(parent, directory); assert.ok(path && !path.startsWith('..') && !isAbsolute(path)); rmSync(directory, { recursive: true, force: true }); });
  const release = join(directory, 'release'), state = join(directory, 'private/state'), backupPrivate = join(directory, 'backup-private');
  privateDirectory(join(directory, 'private')); privateDirectory(state); privateDirectory(backupPrivate);
  for (const name of ['public', '.next', 'node_modules/next/dist/bin', 'hooks']) mkdirSync(join(release, name), { recursive: true });
  writeFileSync(join(release, '.gitignore'), '/node_modules/\n/.next/\n');
  writeFileSync(join(release, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
  writeFileSync(join(release, 'source.txt'), 'synthetic host lifecycle fixture\n');
  const entry = `const http=require('node:http'),fs=require('node:fs');const port=Number(process.argv[process.argv.indexOf('--port')+1]);const names=['PC_APP_BACKUP_STATUS_PATH','PC_APP_BACKUP_INSTANCE_ID','PC_APP_BACKUP_GENERATION','PC_APP_BACKUP_STARTED_AT','PC_APP_BACKUP_DATABASE_SYSTEM_IDENTIFIER'];fs.writeFileSync(process.env.SYNTHETIC_CAPTURE_FILE,JSON.stringify(Object.fromEntries(names.map(k=>[k,process.env[k]]))));const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({version:process.env.VERCEL_GIT_COMMIT_SHA,releaseId:process.env.PC_APP_RELEASE_ID}));});server.listen(port,'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`;
  writeFileSync(join(release, 'node_modules/next/dist/bin/next'), entry);
  const git = args => execFileSync(hostGitPath(), ['-C', release, '-c', `core.hooksPath=${join(release, 'hooks')}`, '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', windowsHide: true }).trim();
  git(['init', '--quiet']); git(['add', '--', '.gitignore', 'package-lock.json', 'source.txt']);
  git(['-c', 'user.name=Synthetic fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'Synthetic owned host fixture']);
  const config = { version: 1, enabled: true, releaseDirectory: release, stateDirectory: state, environmentFile: join(directory, 'private/app.env'),
    backupConfigFile: join(backupPrivate, 'config.json'), expectedBackupInstanceId: randomUUID(), expectedBackupDatabaseSystemIdentifier: '1234567890123456789',
    releaseCommit: git(['rev-parse', 'HEAD']), releaseId: 'synthetic-backup-lifecycle', publicOrigin: 'https://host-backup.example.test', appPort: await unusedPort(), gatewayPort: await unusedPort() };
  const capture = join(state, 'captured-env.json');
  const env = { PC_APP_RUNTIME: 'true', NEXT_PUBLIC_PC_APP_RUNTIME: 'true', PC_BACKEND_ENABLED: 'true', NEXT_PUBLIC_PC_BACKEND: 'true',
    APP_PUBLIC_ORIGIN: config.publicOrigin, NEXT_PUBLIC_SUPABASE_URL: `${config.publicOrigin}/api/pc-supabase`,
    PC_BACKEND_INTERNAL_URL: 'http://127.0.0.1:18180', NEXT_PUBLIC_CLOUD_AUTH_URL: 'http://127.0.0.1:18181', NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY: 'synthetic',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', VERCEL_GIT_COMMIT_SHA: config.releaseCommit, PC_APP_RELEASE_ID: config.releaseId,
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), PC_APP_SYNTHETIC_REVIEW: 'true', NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW: 'true',
    NEXT_PUBLIC_CLOUD_AUTH_MODE: 'test', IMAGE_STORAGE_READ_ONLY: 'true', R2_READ_ENABLED: 'false', R2_WRITE_ENABLED: 'false', SHEET_SYNC_ENABLED: 'false', SYNTHETIC_CAPTURE_FILE: capture };
  writeFileSync(config.environmentFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 });
  const backupConfig = { version: 1, enabled: true, instanceId: config.expectedBackupInstanceId, stateDirectory: join(backupPrivate, 'state'), environmentFile: join(backupPrivate, 'backup.env'),
    wslExecutable: process.execPath, wslSha256: 'a'.repeat(64), dockerExecutable: '/usr/bin/docker', dockerSha256: 'b'.repeat(64), wslDistribution: 'synthetic', wslUser: 'synthetic',
    psqlExecutable: '/usr/bin/psql', pgDumpExecutable: '/usr/bin/pg_dump', pushEnvironmentFile: null,
    capacity: { inventoryLimit: 100, maxLocalBytes: 4 * MIN_MAX_PAIR_BYTES, maxRemoteBytes: 4 * MIN_MAX_PAIR_BYTES,
      minFreeLocalBytes: 1024, maxPairBytes: MIN_MAX_PAIR_BYTES, maxRequestCount: 64, maxTransferBytes: 8 * MIN_MAX_PAIR_BYTES },
    target: { containerId: 'c'.repeat(64), containerImageId: `sha256:${'d'.repeat(64)}`, databaseSystemIdentifier: config.expectedBackupDatabaseSystemIdentifier, databaseName: 'postgres',
      containerName: 'synthetic', composeProject: 'synthetic', composeService: 'db', dataMountSource: '/synthetic/data' } };
  writeFileSync(config.backupConfigFile, JSON.stringify(backupConfig), { mode: 0o600 });
  writeFileSync(backupConfig.environmentFile, `PC_BACKUP_ENCRYPTION_KEY=${'e'.repeat(64)}\nR2_ACCOUNT_ID=${'f'.repeat(32)}\nR2_ACCESS_KEY_ID=synthetic\nR2_SECRET_ACCESS_KEY=synthetic\nR2_BUCKET_NAME=synthetic\n`, { mode: 0o600 });
  writeFileSync(join(release, '.next/required-server-files.json'), JSON.stringify({ config: { deploymentId: config.releaseId } }));
  writeReceipt(state, 'prepared.json', { version: 2, releaseCommit: config.releaseCommit, releaseId: config.releaseId, environmentHash: environmentHash(env), buildHash: buildHash(release), source: sourceProof(release, config.releaseCommit), runtime: createRuntimeManifest(release) });
  const configFile = join(directory, 'private/host.json'); writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
  return { config, configFile, capture, backupPrivate };
}

test('host owns one fresh backup generation, injects it before child startup, and stops only its resources', async t => {
  const f = await fixture(t); let stopped = 0, options;
  const identity = { instanceId: f.config.expectedBackupInstanceId, generation: randomUUID(), startedAt: new Date().toISOString() };
  const running = run(f.configFile, true, { startBackup: async args => { options = args; return { identity, statusPath: join(f.backupPrivate, 'backup-lifecycle.json'), stop: async () => { stopped++; return { drained: true }; } }; } });
  try {
    await waitUntil(() => existsSync(f.capture) && existsSync(join(f.config.stateDirectory, 'runtime-status.json')));
    const env = JSON.parse(readFileSync(f.capture));
    assert.equal(env.PC_APP_BACKUP_GENERATION, identity.generation); assert.equal(env.PC_APP_BACKUP_STARTED_AT, identity.startedAt);
    assert.equal(env.PC_APP_BACKUP_DATABASE_SYSTEM_IDENTIFIER, f.config.expectedBackupDatabaseSystemIdentifier);
    assert.equal(options.expectedInstanceId, f.config.expectedBackupInstanceId);
    assert.equal(options.expectedDatabaseSystemIdentifier, f.config.expectedBackupDatabaseSystemIdentifier);
    const status = JSON.parse(readFileSync(join(f.config.stateDirectory, 'runtime-status.json')));
    assert.equal(status.running, true); assert.equal(status.backup.identity.generation, identity.generation);
  } finally { process.emit('SIGTERM'); await running; }
  assert.equal(stopped, 1); assert.equal(existsSync(join(f.config.stateDirectory, 'runner.lock')), false);
  assert.equal(JSON.parse(readFileSync(join(f.config.stateDirectory, 'runtime-status.json'))).running, false);
  assert.equal((await fetch(`http://127.0.0.1:${f.config.appPort}/api/version`).catch(() => null)), null);
  assert.equal((await fetch(`http://127.0.0.1:${f.config.gatewayPort}/api/version`).catch(() => null)), null);
});

test('a foreign supervisor is stopped without ever starting the application', async t => {
  const f = await fixture(t); let stopped = 0;
  await assert.rejects(run(f.configFile, true, { startBackup: async () => ({ identity: { instanceId: randomUUID(), generation: randomUUID(), startedAt: new Date().toISOString() },
    statusPath: join(f.backupPrivate, 'backup-lifecycle.json'), stop: async () => { stopped++; return { drained: true }; } }) }), /identity/);
  assert.equal(stopped, 1); assert.equal(existsSync(f.capture), false); assert.equal(existsSync(join(f.config.stateDirectory, 'runner.lock')), false);
});

test('fatal backup ownership uncertainty stops new dispatch and reports an incomplete backup drain', async t => {
  const f = await fixture(t); let onFatal, stopped = 0;
  const running = run(f.configFile, true, { startBackup: async args => {
    onFatal = args.onFatal;
    return { identity: { instanceId: f.config.expectedBackupInstanceId, generation: randomUUID(), startedAt: new Date().toISOString() },
      statusPath: join(f.backupPrivate, 'backup-lifecycle.json'), stop: async () => { stopped++; return { drained: false }; } };
  } });
  const rejection = assert.rejects(running, /unexpectedly or drain failed/);
  try { await waitUntil(() => existsSync(f.capture) && existsSync(join(f.config.stateDirectory, 'runtime-status.json'))); }
  finally { onFatal?.(); await rejection; }
  assert.equal(stopped, 1);
  const status = JSON.parse(readFileSync(join(f.config.stateDirectory, 'runtime-status.json')));
  assert.equal(status.running, false); assert.equal(status.drained, false);
  assert.equal((await fetch(`http://127.0.0.1:${f.config.gatewayPort}/api/version`).catch(() => null)), null);
});
