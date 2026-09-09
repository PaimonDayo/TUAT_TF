import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { S3Client } from '@aws-sdk/client-s3';

export const root = resolve(import.meta.dirname, '../..');
export const directory = resolve(root, '.contingency/backend');
export const configPath = resolve(directory, 'config.json');
export function protect(path) {
  if (process.platform !== 'win32') return;
  const account = execFileSync('whoami', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
  execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${account}:(F)`, 'SYSTEM:(F)'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
}
export function writePrivate(path, value) {
  mkdirSync(directory, { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, value, { mode: 0o600 }); protect(temp); renameSync(temp, path);
}
export function readConfig() { return JSON.parse(readFileSync(configPath, 'utf8')); }
export function cloudEnv() { return parseEnv(readFileSync(resolve(root, '.env.local'), 'utf8')); }
export function localEnv() { return parseEnv(readFileSync(resolve(root, '.contingency/local-app.env'), 'utf8')); }
export function r2Client() {
  const env = cloudEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) throw new Error('R2 is not configured');
  return { bucket: env.R2_BUCKET_NAME, client: new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }, maxAttempts: 2,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' }) };
}
