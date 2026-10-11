import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from './gateway.mjs';
import { loadHost, privateDirectory, verifyPrepared, writeReceipt } from './release.mjs';
import { acquireRunnerLock } from './runner-lock.mjs';
import { backupChildEnvironment, backupRuntimeRecord } from './backup-owner.mjs';
import { loadBackup } from '../pc-backup/config.mjs';
import { startBackupSupervisor } from '../pc-backup/run.mjs';

const pause = ms => new Promise(done => setTimeout(done, ms));
export async function probeRelease(config, fetchRequest = fetch) {
  try {
    const response = await fetchRequest(`http://127.0.0.1:${config.appPort}/api/version`, { redirect: 'error', signal: AbortSignal.timeout(3_000) });
    const version = await response.json();
    return response.ok && version.version === config.releaseCommit && version.releaseId === config.releaseId;
  } catch { return false; }
}
export async function stopChild(child, exited, timeoutMs = 35_000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  try { if (child.connected) child.send({ type: 'tuat-pc-host-stop' }); } catch { /* deadline still applies */ }
  let deadline;
  const drained = await Promise.race([exited.then(() => true), new Promise(done => { deadline = setTimeout(() => done(false), timeoutMs); })]);
  clearTimeout(deadline);
  if (!drained) { child.kill('SIGKILL'); await exited; }
  return drained;
}
export async function run(configFile, execute = false, { startBackup = startBackupSupervisor } = {}) {
  const { config, env } = loadHost(configFile);
  verifyPrepared(config, env);
  const backupPlan = loadBackup(config.backupConfigFile);
  if (backupPlan.config.instanceId !== config.expectedBackupInstanceId || backupPlan.config.target.databaseSystemIdentifier !== config.expectedBackupDatabaseSystemIdentifier) throw Error('Backup target does not match the pinned host');
  if (!execute) return { prepared: true, enabled: config.enabled, releaseCommit: config.releaseCommit, releaseId: config.releaseId };
  if (!config.enabled) throw Error('Host is disabled');
  privateDirectory(config.stateDirectory);
  // Recovery only under the managed wrapper's held OS mutex and proven dead owner.
  const lock = acquireRunnerLock(config.stateDirectory);
  let child, gateway, backup, backupRecord, backupStopping, stopped = false, healthy = false, drained = true, unexpectedExit = false;
  let stopResolve;
  const stopping = new Promise(done => { stopResolve = done; });
  const runtimeRecord = running => ({ version: 1, running, releaseCommit: config.releaseCommit, releaseId: config.releaseId,
    startedAt: backupRecord?.identity.startedAt, checkedAt: new Date().toISOString(), backup: backupRecord });
  const stop = () => {
    stopped = true;
    // Protect writes immediately; draining already-dispatched requests still follows.
    if (backup && !backupStopping) backupStopping = Promise.resolve().then(() => backup.stop()).then(result => { if (result?.drained !== true) drained = false; }).catch(() => { drained = false; });
    if (backupRecord) { try { writeReceipt(config.stateDirectory, 'runtime-status.json', runtimeRecord(false)); } catch { drained = false; } }
    stopResolve();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let poll, exited;
  try {
    backup = await startBackup({ configFile: config.backupConfigFile, expectedInstanceId: config.expectedBackupInstanceId, expectedDatabaseSystemIdentifier: config.expectedBackupDatabaseSystemIdentifier,
      onFatal: () => { unexpectedExit = true; stop(); } });
    const boundBackupEnv = backupChildEnvironment(config, backup);
    backupRecord = backupRuntimeRecord(config, backup);
    if (stopped) { stop(); throw Error('Host stopped before application start'); }
    const childEnv = { ...env, ...boundBackupEnv, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
    for (const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE']) if (process.env[key]) childEnv[key] = process.env[key];
    child = spawn(process.execPath, ['--require', resolve(import.meta.dirname, 'graceful-control.cjs'), resolve(config.releaseDirectory, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(config.appPort)], { cwd: config.releaseDirectory, env: childEnv, windowsHide: true, stdio: ['ignore','ignore','ignore','ipc'] });
    exited = new Promise(done => { child.once('exit', code => { if (!stopped) unexpectedExit = true; stop(); done(code); }); child.once('error', () => { unexpectedExit = true; stop(); done(-1); }); });
    const deadline = Date.now() + 60_000;
    while (!stopped && Date.now() < deadline) {
      if (await probeRelease(config)) { healthy = true; break; }
      await pause(250);
    }
    if (!healthy || stopped) throw Error('Pinned application did not start');
    gateway = createGateway({ publicOrigin: config.publicOrigin, appPort: config.appPort });
    await new Promise((done, reject) => { gateway.server.once('error', reject); gateway.server.listen(config.gatewayPort, '127.0.0.1', done); });
    writeReceipt(config.stateDirectory, 'runtime-status.json', runtimeRecord(true));
    console.log(JSON.stringify({ running: true, loopbackOnly: true, releaseId: config.releaseId }));
    poll = setInterval(() => {
      try {
        const current = JSON.parse(readFileSync(configFile, 'utf8'));
        if (JSON.stringify(current) !== JSON.stringify(config)) stop();
        else if (!stopped) writeReceipt(config.stateDirectory, 'runtime-status.json', runtimeRecord(true));
      } catch { stop(); }
    }, 20_000);
    await stopping;
  } finally {
    stop();
    clearInterval(poll);
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    try { if (gateway?.server.listening) await gateway.close(); } catch { drained = false; }
    try { if (child && exited) drained = (await stopChild(child, exited)) && drained; } catch { drained = false; }
    await backupStopping;
    try { writeReceipt(config.stateDirectory, 'runtime-status.json', { ...runtimeRecord(false), drained, stoppedAt: new Date().toISOString() }); }
    finally { lock.release(); }
  }
  if (unexpectedExit || !drained) throw Error('Application ended unexpectedly or drain failed');
  return { stopped: true, drained };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv[2], process.argv[3] === '--execute').then(value => console.log(JSON.stringify(value))).catch(error => {
    const message = error?.code === 'ERR_PC_HOST_REBUILD_REQUIRED' ? 'PC host receipt requires a rebuild; no host was started.' : error?.code === 'ERR_PC_HOST_TOOL_UNAVAILABLE' ? 'PC host requires its pinned executables; no host was started.' : 'PC host was not started or stopped safely; inspect protected state';
    console.error(message);
    process.exitCode = 1;
  });
}
