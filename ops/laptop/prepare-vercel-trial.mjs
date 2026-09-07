// Stage only app sources and explicitly selected PC credentials for an isolated Preview.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
const root = resolve(import.meta.dirname, '../..');
const local = parseEnv(readFileSync(resolve(root, '.contingency/local-app.env'), 'utf8'));
if (local.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:8000') throw Error('Local PC configuration required');
const configFile = resolve(root, '.contingency/private-trial.json');
const config = JSON.parse(readFileSync(configFile, 'utf8'));
if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(config.origin)) throw Error('Expected private trial tunnel');
if (!config.bridgeKey) { config.bridgeKey = randomBytes(32).toString('base64url'); writeFileSync(configFile, JSON.stringify(config, null, 2)); }
const stage = resolve(root, '.contingency/vercel-pc-preview');
mkdirSync(stage, { recursive: true });
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src', 'public', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of files) {
  const destination = resolve(stage, file);
  if (!destination.startsWith(stage + '/') && !destination.startsWith(stage + '\\')) throw Error('Invalid staging path');
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(root, file), destination);
}
const bridge = `${config.origin}/_pc/bridge`;
const env = {
  NEXT_PUBLIC_PC_TRIAL: 'true', PC_TRIAL_VERCEL: 'true',
  PC_TRIAL_BRIDGE_URL: bridge, PC_TRIAL_BRIDGE_KEY: config.bridgeKey,
  NEXT_PUBLIC_SUPABASE_URL: `${bridge}/_pc/supabase`,
  IMAGE_STORAGE_READ_ONLY: 'true', R2_UPLOADS_PAUSED: 'true', R2_WRITE_ENABLED: 'false',
};
env.NEXT_PUBLIC_SUPABASE_ANON_KEY = local.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// The privileged DB key and all R2 credentials stay on the PC. Image reads use
// the authenticated image handlers on the existing local app.
writeFileSync(resolve(stage, 'vercel.json'), JSON.stringify({ framework: 'nextjs', regions: ['hnd1'], env, build: { env } }, null, 2));
if (process.platform === 'win32') {
  const owner = execFileSync('whoami', [], { encoding: 'utf8' }).trim();
  execFileSync('icacls', [resolve(stage, 'vercel.json'), '/inheritance:r', '/grant:r', `${owner}:(F)`, 'SYSTEM:(F)'], { stdio: 'ignore' });
}
writeFileSync(resolve(stage, '.vercelignore'), '.env*\n');
console.log(`Staged ${files.length} source files for the private PC Preview. No production environment was loaded.`);
