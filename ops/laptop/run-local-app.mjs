// Development rehearsal only: production builds embed the production public URL.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const env = { ...process.env };
// Explicit empty values prevent Next.js from loading cloud-only credentials from
// the repository's normal environment files (GAS, OAuth, notification secrets).
for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
  const path = resolve(root, name);
  if (existsSync(path)) {
    for (const key of Object.keys(parseEnv(readFileSync(path, 'utf8')))) env[key] = '';
  }
}
const local = parseEnv(readFileSync(resolve(root, '.contingency/local-app.env'), 'utf8'));
if (local.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:8000' || local.IMAGE_STORAGE_READ_ONLY !== 'true') {
  throw new Error('Expected the isolated, read-only local rehearsal configuration');
}
Object.assign(env, local, { NODE_ENV: 'development' });
const child = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', '3008'], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
