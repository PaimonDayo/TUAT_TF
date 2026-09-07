// Build/run the private trial without inheriting production-only credentials.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
const local = parseEnv(readFileSync(resolve(root, '.contingency/local-app.env'), 'utf8'));
if (local.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:8000') throw Error('Local API only');
const env = { ...process.env };
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local']) {
  if (existsSync(resolve(root, file))) for (const key of Object.keys(parseEnv(readFileSync(resolve(root, file), 'utf8')))) env[key] = '';
}
// Do not pass copied Google refresh-token encryption keys or OAuth/GAS/Push credentials.
for (const key of Object.keys(env)) if (/^(SUPABASE_|NEXT_PUBLIC_|GOOGLE_|SHEET_|GAS_|VAPID_|R2_|CLOUDFLARE_|VERCEL_|CRON_|LEGACY_)/.test(key)) env[key] = '';
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_READ_ENABLED']) env[key] = local[key] ?? '';
Object.assign(env, { NODE_ENV: 'production', NEXT_PUBLIC_PC_TRIAL: 'true', IMAGE_STORAGE_READ_ONLY: 'true', R2_UPLOADS_PAUSED: 'true', R2_WRITE_ENABLED: 'false' });
const mode = process.argv[2];
if (!['build', 'start'].includes(mode)) throw Error('Expected build or start');
const args = mode === 'build' ? ['build'] : ['start', '-H', '127.0.0.1', '-p', '3009'];
const child = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), ...args], { cwd: root, env, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
