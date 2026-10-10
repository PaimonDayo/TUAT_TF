// Separate opt-in adapter. Never reads rollback/mirror config, installs a task or runs on import.
import { readFileSync, existsSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import { resolve, isAbsolute, dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digest, planSync, summaryOf, readSnapshot, targetSnapshot, applyPlan, pendingWrites, reconcile } from './sync.mjs';
import { privateDirectory } from '../pc-host/release.mjs';

export function validateConfig(config, env) {
  if (config.version !== 1 || typeof config.enabled !== 'boolean' || !isAbsolute(config.environmentFile ?? '') ||
      !isAbsolute(config.stateDirectory ?? '') || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(config.sourceId ?? '')) throw Error('Explicit independent Auth sync configuration required');
  let pc, cloud;
  try { pc = new URL(config.pcUrl); cloud = new URL(config.cloudAuthUrl); } catch { throw Error('Explicit Auth sync targets required'); }
  if (pc.protocol !== 'http:' || pc.hostname !== '127.0.0.1' || pc.origin !== config.pcUrl || !pc.port || Number(pc.port) < 1024 ||
      cloud.protocol !== 'https:' || cloud.origin !== config.cloudAuthUrl || !/^[a-z0-9]+$/.test(config.cloudProjectRef ?? '') ||
      cloud.hostname !== `${config.cloudProjectRef}.supabase.co` || pc.username || pc.password || cloud.username || cloud.password) throw Error('Pinned loopback PC and cloud Auth targets required');
  for (const name of ['PC_AUTH_SYNC_SERVICE_ROLE_KEY', 'CLOUD_AUTH_SYNC_SERVICE_ROLE_KEY']) {
    if (typeof env[name] !== 'string' || !env[name] || /[\r\n]/.test(env[name])) throw Error('Dedicated Auth sync credential required');
  }
  // Deliberately no NEXT_PUBLIC_ app credentials, inherited secrets or cloud business target.
  return { pc: { name: 'pc', url: config.pcUrl, key: env.PC_AUTH_SYNC_SERVICE_ROLE_KEY },
    cloud: { name: 'cloud', url: config.cloudAuthUrl, key: env.CLOUD_AUTH_SYNC_SERVICE_ROLE_KEY } };
}

export function writePrivate(file, value) {
  // Verify the exact owner+SYSTEM parent ACL before a single sensitive byte is written.
  privateDirectory(dirname(file));
  if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())) throw Error('Private file may not be redirected');
  const temp = `${file}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, file);
  if (process.platform !== 'win32') {
    const directory = openSync(dirname(file), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}

function loadState(file, targetId) {
  if (!existsSync(file)) return { version: 1, targetId, operations: {} };
  const state = JSON.parse(readFileSync(file, 'utf8'));
  if (state.version !== 1 || state.targetId !== targetId || !state.operations || typeof state.operations !== 'object' || Array.isArray(state.operations)) throw Error('Auth sync journal target mismatch');
  for (const [key, record] of Object.entries(state.operations)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}$/.test(record.desired ?? '') ||
        !['running', 'success', 'uncertain'].includes(record.status)) throw Error('Invalid Auth sync journal');
    if (record.status === 'running') record.status = 'uncertain';
  }
  return state;
}

export async function run(configFile, mode = '--dry-run', { fetchRequest = fetch, save = writePrivate, now = Date.now() } = {}) {
  if (!['--check', '--dry-run', '--apply', '--reconcile'].includes(mode)) throw Error('Invalid Auth sync mode');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const env = parseEnv(readFileSync(config.environmentFile, 'utf8'));
  const sides = validateConfig(config, env);
  const targetId = digest({ sourceId: config.sourceId, pc: config.pcUrl, cloud: config.cloudAuthUrl });
  if (mode === '--check') return { valid: true, enabled: config.enabled, reads: false, writes: false };
  if (mode === '--apply' && !config.enabled) throw Error('Auth sync apply is disabled');
  // Creates/protects a new directory, rejects an unsafe existing ACL or junction.
  // This must precede lock creation as well as snapshots and journal writes.
  privateDirectory(config.stateDirectory);
  const journal = resolve(config.stateDirectory, 'auth-sync-journal.json');
  const receiptFile = resolve(config.stateDirectory, 'auth-sync-preview.json');
  const snapshotFile = resolve(config.stateDirectory, 'auth-sync-target-snapshot.json');
  // Same lock for dry-run/reconcile/apply. Never steal a stale lock or compete with another adapter.
  const lockFile = resolve(config.stateDirectory, 'auth-sync.lock');
  const lock = openSync(lockFile, 'wx', 0o600);
  try {
    const state = loadState(journal, targetId);
    const snapshot = await readSnapshot(sides, fetchRequest);
    const plan = planSync(snapshot), summary = summaryOf(plan);
    if (mode === '--reconcile') {
      const preview = JSON.parse(readFileSync(receiptFile, 'utf8'));
      if (preview.targetId !== targetId) throw Error('Reconciliation target mismatch');
      return { reconciled: true, ...await reconcile({ plan: preview.plan, state, snapshot, save: value => save(journal, value) }), writes: false };
    }
    if (pendingWrites(state)) throw Error('Unresolved Auth sync journal requires reconciliation');
    if (mode === '--dry-run') {
      // Snapshot and operation payloads contain identities. Keep them private; stdout has counts only.
      const target = targetSnapshot(snapshot);
      save(snapshotFile, { version: 1, targetId, capturedAt: new Date(now).toISOString(), target });
      save(receiptFile, { version: 1, targetId, capturedAt: new Date(now).toISOString(), plan, planHash: digest(plan), targetHash: digest(target) });
      return { dryRun: true, enabled: config.enabled, writes: false, planned: summary };
    }
    const preview = JSON.parse(readFileSync(receiptFile, 'utf8'));
    const before = JSON.parse(readFileSync(snapshotFile, 'utf8'));
    const age = now - Date.parse(preview.capturedAt);
    if (preview.version !== 1 || preview.targetId !== targetId || before.targetId !== targetId || !(age >= 0 && age < 10 * 60000) ||
        preview.planHash !== digest(plan) || preview.targetHash !== digest(targetSnapshot(snapshot)) || preview.targetHash !== digest(before.target)) throw Error('Fresh matching dry-run and target snapshot required');
    await applyPlan({ plan, state, sides, fetchRequest, save: value => save(journal, value) });
    const after = await readSnapshot(sides, fetchRequest);
    if (plan.some(operation => !operation.type.startsWith('allowlist-') && !after.pcUsers.some(user => user.id === operation.row.id))) throw Error('Auth identity verification failed');
    const remaining = summaryOf(planSync(after));
    if (Object.values(remaining).some(count => count > 0)) throw Error('Auth sync changed during execution; repeat dry-run before further writes');
    return { applied: true, planned: summary, remaining };
  } finally { closeSync(lock); unlinkSync(lockFile); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , first, second] = process.argv;
  const mode = first?.startsWith('--') ? first : '--dry-run';
  const configFile = first?.startsWith('--') ? second : first;
  if (!configFile) throw Error('Usage: node run.mjs [--check|--dry-run|--apply|--reconcile] <private-config.json>');
  try { console.log(JSON.stringify(await run(resolve(configFile), mode))); }
  catch { console.error('Auth sync stopped. Inspect its private snapshot and journal; do not resend unresolved writes.'); process.exitCode = 1; }
}
