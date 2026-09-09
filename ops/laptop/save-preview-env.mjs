import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { directory, writePrivate, cloudEnv } from './backend-files.mjs';
const cli = 'C:/Users/rainb/AppData/Local/npm-cache/_npx/c5e9bca3acff8f7b/node_modules/vercel/dist/vc.js';
const production = process.argv.includes('--production');
const restoreCloud = process.argv.includes('--restore-cloud');
if (restoreCloud && (!production || !process.argv.includes('--cloud-data-verified'))) throw Error('Cloud return requires production scope and verified imported data');
const project = production ? 'prj_fLc2aGQHb2Ny4IMt21ESzN0ij25p' : 'prj_dKdlUzqnRYKvwsugXRZ72Wg7L5fr';
const settings = production
  ? Object.entries(JSON.parse(readFileSync(resolve(directory, restoreCloud ? 'production-rollback-env.json' : 'vercel-env.json'), 'utf8'))).map(([key,value]) => ({ key, value, type: key.startsWith('NEXT_PUBLIC_') ? 'encrypted' : 'sensitive', target: ['production'] }))
  : JSON.parse(readFileSync(resolve(directory, 'preview-env-request.json'), 'utf8'));
if (production && !existsSync(resolve(directory, 'production-rollback-env.json'))) {
  const cloud = cloudEnv();
  writePrivate(resolve(directory, 'production-rollback-env.json'), JSON.stringify({ NEXT_PUBLIC_SUPABASE_URL: cloud.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: cloud.NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: cloud.SUPABASE_SERVICE_ROLE_KEY, PC_BACKEND_ENABLED: 'false', NEXT_PUBLIC_PC_BACKEND: 'false' }));
}
let count = 0;
for (const setting of settings) {
  const input = resolve(directory, 'preview-env-single.json');
  writePrivate(input, JSON.stringify(setting));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [cli, 'api', `/v10/projects/${project}/env?upsert=true`, '--method', 'POST', '--input', input, '--scope', 'paimondayos-projects', '--raw'], { timeout: 60_000, windowsHide: true });
    const result = JSON.parse(stdout);
    if (result.error || result.failed?.length) throw Error('Environment rejected');
    console.log(`Saved ${++count}/${settings.length}: ${setting.key}`);
  } catch (error) {
    console.error(`Saving ${setting.key} failed. No secret values displayed.`);
    let message = String(error.stderr ?? error.message ?? 'Unknown error');
    for (const value of settings.map(item => item.value).filter(value => value.length > 3)) message = message.split(value).join('[redacted]');
    console.error(message.slice(0, 1200));
    process.exitCode = 1;
    break;
  }
}
