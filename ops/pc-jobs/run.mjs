// Opt-in local-only runner. Does not install tasks, change Vercel, or start on import.
import { readFileSync, existsSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initialState, recoverState, tick, JOBS } from './scheduler.mjs';

export function validateConfig(config, env) {
  if (config.version !== 1 || typeof config.enabled !== 'boolean' || !isAbsolute(config.releaseDirectory ?? '') || !isAbsolute(config.stateDirectory ?? '') || !isAbsolute(config.backendDirectory ?? '') || !isAbsolute(config.environmentFile ?? '')) throw Error('Explicit local configuration required');
  if (!/^[a-f0-9]{40}$/.test(config.releaseCommit ?? '')) throw Error('Pinned release commit required');
  if (!Number.isFinite(Date.parse(config.activateAt)) || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw Error('Invalid activation time or port');
  if (env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:8000' || env.PC_BACKEND_ENABLED !== 'false' || env.NEXT_PUBLIC_PC_BACKEND !== 'false' || env.SHEET_SYNC_ENABLED !== 'true') throw Error('Jobs must use the approved PC loopback database');
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'CRON_SECRET', 'SHEET_SYNC_SECRET']) if (!env[name]) throw Error(`Missing ${name}`);
  if (env.PC_TRIAL_VERCEL === 'true' || env.NEXT_PUBLIC_PC_TRIAL === 'true' || env.VERCEL || env.NEXT_PUBLIC_PC_REST_RELAY_ORIGIN) throw Error('Unexpected deployment environment');
  for (const name of ['SHEET_SYNC_GAS_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) if (!env[name]) throw Error(`Missing ${name}`);
  if (env.R2_READ_ENABLED !== 'true' || env.R2_WRITE_ENABLED !== 'true' || env.IMAGE_STORAGE_READ_ONLY === 'true') throw Error('Preserve the production image cleanup configuration');
  if (!/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID)) throw Error('Invalid R2 account');
  if (env.NEXT_PUBLIC_CLOUD_AUTH_URL || env.NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY) throw Error('Local jobs must not use cloud failover');
}

export async function executeLocalJob(base, env, job) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw Error('Local-only job target required');
  const response = await fetch(base + job.path, {
    method: job.method, redirect: 'error', signal: AbortSignal.timeout(job.timeout),
    headers: { authorization: `Bearer ${job.id === 'cleanup' ? env.CRON_SECRET : env.SHEET_SYNC_SECRET}`, 'content-type': 'application/json' },
    ...(job.method === 'POST' ? { body: job.skipSheetWrites ? JSON.stringify({ skipSheetWrites: true }) : '{}' } : {}),
  });
  return { ok: response.ok, status: response.status, value: await response.json() };
}

function saveFile(file, value) {
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
}

export async function run(configFile, execute = false) {
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const env = parseEnv(readFileSync(config.environmentFile, 'utf8'));
  validateConfig(config, env);
  const manifest = JSON.parse(readFileSync(resolve(config.releaseDirectory, 'pc-jobs-release.json'), 'utf8'));
  if (manifest.commit !== config.releaseCommit || manifest.database !== 'pc-loopback') throw Error('Release manifest mismatch');
  if (!existsSync(resolve(config.releaseDirectory, '.next/BUILD_ID'))) throw Error('Build the pinned release before activation');
  if (!execute) { console.log(JSON.stringify({ valid: true, jobs: JOBS.map(j => j.id), enabled: false })); return; }
  if (!config.enabled) throw Error('Scheduler is disabled');
  const journal = resolve(config.stateDirectory, 'journal.json');
  // Exclusive, fail-closed lock. A stale lock is NOT automatically stolen after a crash.
  const lockPath = resolve(config.stateDirectory, 'runner.lock');
  const lock = openSync(lockPath, 'wx', 0o600);
  writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  let child, stopping = false;
  // Finish the in-flight request before stopping the local server.
  const shutdown = () => { stopping = true; };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  try {
    const state = existsSync(journal) ? recoverState(JSON.parse(readFileSync(journal, 'utf8'))) : initialState(Date.parse(config.activateAt));
    if (state.activateAt !== Date.parse(config.activateAt)) throw Error('Activation boundary differs from existing journal');
    saveFile(journal, state);
    // No public listener and no tunnel to this server. Raw handler logs can contain
    // member details, so they are not sent to console or a shared log.
    const childEnv = { ...env, NODE_ENV: 'production' };
    // Carry OS essentials, never inherited app/cloud credentials or trial flags.
    for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) childEnv[name] = process.env[name];
    child = spawn(process.execPath, [resolve(config.releaseDirectory, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(config.port)], {
      cwd: config.releaseDirectory, env: childEnv, windowsHide: true, stdio: 'ignore',
    });
    child.on('error', shutdown);
    child.on('exit', () => { stopping = true; });
    const base = `http://127.0.0.1:${config.port}`;
    const probeReady = async () => {
      try {
        // Operator can disable future starts without killing an in-flight save.
        if (stopping) return false;
        if (JSON.parse(readFileSync(configFile, 'utf8')).enabled !== true) { stopping = true; return false; }
        const backend = JSON.parse(readFileSync(resolve(config.backendDirectory, 'config.json'), 'utf8'));
        const heartbeat = JSON.parse(readFileSync(resolve(config.backendDirectory, 'runtime-status.json'), 'utf8'));
        const backup = JSON.parse(readFileSync(resolve(config.backendDirectory, 'backup-status.json'), 'utf8'));
        if (backend.maintenance || (backend.returnAt && Date.now() >= Date.parse(backend.returnAt)) || !heartbeat.healthy || heartbeat.maintenance ||
            !(Date.now() - Date.parse(heartbeat.checkedAt) < 120000) || !(Date.now() - Date.parse(backup.completedAt) < 35 * 60000)) return false;
        const response = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
        return !stopping && response.ok && (await response.json()).version === config.releaseCommit;
      } catch { return false; }
    };
    const ready = probeReady;
    while (!stopping) {
      await tick({ state, now: Date.now(), ready, save: value => saveFile(journal, value), execute: job => executeLocalJob(base, env, job) });
      saveFile(resolve(config.stateDirectory, 'status.json'), { checkedAt: new Date().toISOString(), jobs: state.jobs });
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill(); await exited;
    }
    closeSync(lock);
    // On an unclean process termination the lock remains for operator review.
    unlinkSync(lockPath);
    process.off('SIGINT', shutdown); process.off('SIGTERM', shutdown);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , mode, configFile] = process.argv;
  if (!['--check', '--run'].includes(mode) || !configFile) throw Error('Usage: node run.mjs --check|--run <private-config.json>');
  await run(resolve(configFile), mode === '--run');
}
