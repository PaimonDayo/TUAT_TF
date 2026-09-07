// Build the exact Preview environment locally without deploying any secrets.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
const staged = JSON.parse(readFileSync(resolve(root, '.contingency/vercel-pc-preview/vercel.json'), 'utf8'));
if (staged.env.PC_TRIAL_VERCEL !== 'true' || staged.env.SUPABASE_SERVICE_ROLE_KEY || staged.env.R2_SECRET_ACCESS_KEY) throw Error('Expected isolated Preview configuration');
const env = { ...process.env };
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  if (existsSync(resolve(root, file))) for (const key of Object.keys(parseEnv(readFileSync(resolve(root, file), 'utf8')))) env[key] = '';
}
for (const key of Object.keys(env)) if (/^(SUPABASE_|NEXT_PUBLIC_|GOOGLE_|SHEET_|GAS_|VAPID_|R2_|CLOUDFLARE_|VERCEL_|CRON_|LEGACY_|PC_TRIAL_)/.test(key)) env[key] = '';
Object.assign(env, staged.env, { NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'preview' });
const mode = process.argv[2] ?? 'build';
if (!['build', 'start'].includes(mode)) throw Error('Expected build or start');
const args = mode === 'build' ? ['build'] : ['start', '-H', '127.0.0.1', '-p', '3010'];
const child = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), ...args], { cwd: root, env, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
