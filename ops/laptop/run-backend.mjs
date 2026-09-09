import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createBackendGateway } from './backend-gateway.mjs';
import { readConfig, directory, root, r2Client, writePrivate } from './backend-files.mjs';
import { backupBackend } from './backup-backend.mjs';

const config = readConfig();
let stopping = false, tunnel, origin, failures = 0, lastRestart = 0, restartCount = 0, currentGeneration = 0;
let lastBackup = 0, busy = false, backupPending = false, lastBackupAttempt = 0;
const { client, bucket } = r2Client();
const maintenance = () => {
  try {
    const state = readConfig();
    return state.maintenance || (state.returnAt && Date.now() >= Date.parse(state.returnAt)) || !lastBackup || Date.now() - lastBackup > 35 * 60_000;
  } catch { return true; }
};
const gateway = createBackendGateway({ key: config.bridgeKey, instanceId: config.instanceId, isMaintenance: maintenance });
await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(3109, '127.0.0.1', resolve); });
function launchTunnel() {
  if (stopping) return;
  if (tunnel && tunnel.exitCode === null) tunnel.kill();
  origin = undefined;
  lastRestart = Date.now();
  const generation = ++currentGeneration;
  tunnel = spawn(resolve(root, '.contingency/bin/cloudflared.exe'), ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:3109'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  const inspect = chunk => {
    if (generation !== currentGeneration) return;
    tail = (tail + chunk.toString()).slice(-8000);
    const match = tail.match(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/);
    if (match && !origin) { origin = match[0]; console.log('Tunnel address obtained; checking before publication.'); }
  };
  tunnel.stdout.on('data', inspect); tunnel.stderr.on('data', inspect);
  tunnel.on('error', () => { if (generation === currentGeneration) origin = undefined; });
  tunnel.on('exit', () => { if (generation === currentGeneration) origin = undefined; });
}
async function tick() {
  if (busy || stopping) return;
  busy = true;
  try {
    // Backups must never delay renewal of the short-lived tunnel endpoint.
    if (!backupPending && (!lastBackup || Date.now() - lastBackup > 15 * 60_000) && Date.now() - lastBackupAttempt > 60_000) {
      backupPending = true; lastBackupAttempt = Date.now();
      void backupBackend().then(() => { lastBackup = Date.now(); })
        .catch(() => console.error('Backup failed; will retry.'))
        .finally(() => { backupPending = false; });
    }
    let healthy = false;
    if (origin) try {
      const response = await fetch(`${origin}/health`, { headers: { 'x-pc-backend-key': config.bridgeKey }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
      healthy = response.ok && (await response.json()).instanceId === config.instanceId;
      if (!healthy) console.error(`Tunnel health returned ${response.status}.`);
    } catch (error) { console.error(`Tunnel health failed: ${error.name}.`); }
    if (healthy) {
      failures = 0;
      const expiresAt = Date.now() + 180_000;
      const data = { version: 1, origin, instanceId: config.instanceId, expiresAt,
        signature: createHmac('sha256', config.bridgeKey).update(JSON.stringify([1, origin, config.instanceId, expiresAt])).digest('hex') };
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: `ops/pc-backend/${config.instanceId}/endpoint.json`, Body: JSON.stringify(data), ContentType: 'application/json', CacheControl: 'no-store' }), { abortSignal: AbortSignal.timeout(10_000) });
      writePrivate(resolve(directory, 'runtime-status.json'), JSON.stringify({ checkedAt: new Date().toISOString(), origin, healthy, maintenance: maintenance(), restarts: restartCount }));
    } else if (++failures >= 3 && Date.now() - lastRestart > 60_000) {
      restartCount++; failures = 0; launchTunnel(); console.log('Reconnecting backend tunnel.');
    }
  } catch (error) { console.error(`Backend supervision failed: ${error.name}; endpoint expires unless renewed.`); }
  finally { busy = false; }
}
// A restored backup status is informative only; each supervisor start verifies a fresh remote backup.
if (existsSync(resolve(directory, 'runtime-status.json'))) readFileSync(resolve(directory, 'runtime-status.json'));
launchTunnel();
process.on('exit', () => tunnel?.kill());
await tick();
const timer = setInterval(tick, 20_000);
// The task host can be terminated by Windows without delivering a Node signal.
// Do not leave an unsupervised child holding port 3109 and blocking its successor.
if (process.platform === 'win32') setInterval(() => {
  try { process.kill(process.ppid, 0); }
  catch { stopping = true; tunnel?.kill(); gateway.close(); client.destroy(); process.exit(1); }
}, 10_000).unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; clearInterval(timer); tunnel?.kill(); gateway.close(); client.destroy(); });
console.log('PC backend supervisor started on loopback; maintenance remains controlled by config.');
