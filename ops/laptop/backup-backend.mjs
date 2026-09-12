import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readConfig, directory, writePrivate, r2Client } from './backend-files.mjs';
import { wslArgs } from './server-profile.mjs';

// 15分ごとのバックアップをローカルにも残すが、R2へ検証済みで上がった分だけ
// 世代を絞る。R2へ上げられなかったファイル（.enc のまま）はここでは消さない
// ＝唯一の控えを自動削除しないための境界。
const KEEP_LOCAL_BACKUPS = 24;
const UPLOADED_SUFFIX = '.uploaded.enc';
function pruneLocalBackups() {
  const uploaded = readdirSync(directory).filter((name) => name.startsWith('backup-') && name.endsWith(UPLOADED_SUFFIX)).sort();
  for (const name of uploaded.slice(0, Math.max(0, uploaded.length - KEEP_LOCAL_BACKUPS))) {
    rmSync(resolve(directory, name), { force: true });
  }
}

export function encryptBackup(bytes, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([Buffer.from('TUATPC01'), iv, cipher.getAuthTag(), encrypted]);
}
export function decryptBackup(bytes, key) {
  if (bytes.subarray(0, 8).toString() !== 'TUATPC01') throw new Error('Invalid backup format');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), bytes.subarray(8, 20));
  decipher.setAuthTag(bytes.subarray(20, 36));
  return Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
}
export async function backupBackend() {
  const config = readConfig();
  const { stdout: dump } = await promisify(execFile)('wsl', [...wslArgs(), 'docker', 'exec', 'supabase-db',
    'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--format=custom', '--schema=public', '--schema=auth', '--schema=storage'],
    { maxBuffer: 128 * 1024 * 1024, timeout: 120_000, encoding: 'buffer', windowsHide: true });
  if (dump.subarray(0, 5).toString() !== 'PGDMP') throw new Error('Database backup is incomplete');
  const encrypted = encryptBackup(dump, config.backupKey);
  if (!decryptBackup(encrypted, config.backupKey).equals(dump)) throw new Error('Backup encryption verification failed');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const local = resolve(directory, `backup-${stamp}.enc`);
  writePrivate(local, encrypted);
  const key = `ops/pc-backend/${config.instanceId}/backups/${stamp}.dump.enc`;
  const hash = createHash('sha256').update(encrypted).digest('hex');
  const { client, bucket } = r2Client();
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: encrypted, ContentType: 'application/octet-stream', IfNoneMatch: '*', Metadata: { sha256: hash } }), { abortSignal: AbortSignal.timeout(30_000) });
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(10_000) });
    if (head.ContentLength !== encrypted.length || head.Metadata?.sha256 !== hash) throw new Error('Remote backup verification failed');
    writePrivate(resolve(directory, 'backup-status.json'), JSON.stringify({ completedAt: new Date().toISOString(), key, bytes: encrypted.length, sha256: hash }));
    renameSync(local, resolve(directory, `backup-${stamp}${UPLOADED_SUFFIX}`));
    pruneLocalBackups();
    console.log(`Encrypted backup verified: ${encrypted.length} bytes`);
    return key;
  } finally { client.destroy(); }
}
export async function downloadAndVerifyLatest() {
  const config = readConfig();
  const status = JSON.parse(readFileSync(resolve(directory, 'backup-status.json'), 'utf8'));
  if (!status.key.startsWith(`ops/pc-backend/${config.instanceId}/backups/`)) throw new Error('Unexpected backup key');
  const { client, bucket } = r2Client();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: status.key }), { abortSignal: AbortSignal.timeout(30_000) });
    const encrypted = Buffer.from(await result.Body.transformToByteArray());
    if (createHash('sha256').update(encrypted).digest('hex') !== status.sha256) throw new Error('Backup checksum mismatch');
    const dump = decryptBackup(encrypted, config.backupKey);
    const path = resolve(directory, 'restore-rehearsal.dump');
    writePrivate(path, dump);
    console.log('Downloaded backup checksum and authenticated decryption verified.');
    return path;
  } finally { client.destroy(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { if (process.argv.includes('--verify-download')) await downloadAndVerifyLatest(); else await backupBackend(); }
  catch { console.error('Backup failed; inspect local configuration and connectivity.'); process.exitCode = 1; }
}
