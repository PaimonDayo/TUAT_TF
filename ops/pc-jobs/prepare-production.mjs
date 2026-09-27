// Prepare a disabled, private PC job candidate; never starts jobs or changes Vercel.
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { cloudEnv, localEnv, readConfig, writePrivate, protect, directory, root } from '../laptop/backend-files.mjs';
import { validateConfig } from './run.mjs';
const release = resolve(process.argv[2] ?? '');
if (!release.startsWith(resolve(root, '.contingency') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))) throw Error('Isolated release required');
const manifest = JSON.parse(readFileSync(resolve(release, 'pc-jobs-release.json'), 'utf8'));
if (manifest.target !== 'pc') throw Error('PC release required');
const file = resolve(directory, 'pc-jobs-production.env');
if (existsSync(file)) throw Error('Existing private candidate must be reviewed, not overwritten');
const backend = readConfig(), cloud = cloudEnv(), local = localEnv();
const sync = parseEnv(readFileSync(resolve(directory, 'pc-jobs-sync.env'), 'utf8'));
const deployed = JSON.parse(readFileSync(resolve(directory, 'cutover-deployed-sync.json'), 'utf8'));
const env = {};
for (const key of ['SHEET_SYNC_GAS_URL', 'SHEET_SYNC_SPREADSHEET_ID', 'SHEET_SYNC_CHUNK_SIZE', 'SHEET_SYNC_PUSH_LIMIT', 'SHEET_SYNC_CONCURRENCY', 'GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REDIRECT_URI']) if (deployed[key]) env[key] = deployed[key];
for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_ENCRYPTION_KEY']) if (cloud[key]) env[key] = cloud[key];
for (const key of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_ENCRYPTION_KEY']) if (local[key]) env[key] = local[key];
for (const key of ['SHEET_SYNC_SECRET', 'SHEET_SYNC_GAS_URL', 'CRON_SECRET']) if (sync[key]) env[key] = sync[key];
// Cleanup is authenticated only between this local runner and its private Next server.
// A dedicated secret avoids changing or needing Vercel's existing cron credential.
env.CRON_SECRET = randomBytes(32).toString('hex');
Object.assign(env, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:8000', PC_BACKEND_ENABLED: 'false', NEXT_PUBLIC_PC_BACKEND: 'false', SHEET_SYNC_ENABLED: 'true', R2_READ_ENABLED: 'true', R2_WRITE_ENABLED: 'true', IMAGE_STORAGE_READ_ONLY: 'false', VERCEL_GIT_COMMIT_SHA: manifest.commit, NEXT_TELEMETRY_DISABLED: '1' });
const stateDirectory = resolve(directory, 'pc-jobs-state');
const config = { version: 1, enabled: false, releaseDirectory: release, stateDirectory, backendDirectory: directory, environmentFile: file, releaseCommit: manifest.commit, activateAt: '2099-01-01T00:00:00.000Z', port: 3112 };
validateConfig(config, env);
mkdirSync(stateDirectory, { recursive: true }); protect(stateDirectory);
writePrivate(file, Object.entries(env).map(([key,value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n');
writePrivate(resolve(directory, 'pc-jobs-production.json'), JSON.stringify(config, null, 2));
console.log('Private candidate prepared, disabled. Build, dry-run review and Vercel cutover are required before activation. External email monitoring remains discontinued.');
