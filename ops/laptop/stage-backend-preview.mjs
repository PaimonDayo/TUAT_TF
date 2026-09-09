import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, directory, writePrivate, cloudEnv } from './backend-files.mjs';

const production = process.argv.includes('--production');
const stage = resolve(directory, production ? 'app-production' : 'app-preview');
mkdirSync(stage, { recursive: true });
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src', 'public', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of files) {
  const destination = resolve(stage, file);
  if (!destination.startsWith(stage + '/') && !destination.startsWith(stage + '\\')) throw Error('Invalid stage path');
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(root, file), destination);
}
writeFileSync(resolve(stage, 'vercel.json'), production ? readFileSync(resolve(root, 'vercel.json')) : JSON.stringify({ framework: 'nextjs', regions: ['hnd1'] }));
writeFileSync(resolve(stage, '.vercelignore'), '.env*\n');
mkdirSync(resolve(stage, '.vercel'), { recursive: true });
writeFileSync(resolve(stage, '.vercel/project.json'), JSON.stringify({ projectId: production ? 'prj_fLc2aGQHb2Ny4IMt21ESzN0ij25p' : 'prj_dKdlUzqnRYKvwsugXRZ72Wg7L5fr', orgId: 'team_kxzFfl8gjcBDe6W8AayTW156', projectName: production ? 'tuat-tf' : 'tuat-tf-pc-preview' }));
if (production) { console.log(`Prepared ${files.length} source files for production without local secrets.`); process.exit(0); }
const env = JSON.parse(readFileSync(resolve(directory, 'vercel-env.json'), 'utf8'));
env.NEXT_PUBLIC_SUPABASE_URL = 'https://tuat-tf-pc-preview.vercel.app/api/pc-supabase';
const cloud = cloudEnv();
for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'NEXT_PUBLIC_UNIVERSITY_DOMAIN']) {
  if (cloud[key]) env[key] = cloud[key];
}
Object.assign(env, { R2_READ_ENABLED: 'true', R2_WRITE_ENABLED: 'false', R2_UPLOADS_PAUSED: 'true', IMAGE_STORAGE_READ_ONLY: 'true', SHEET_SYNC_ENABLED: 'false' });
writePrivate(resolve(directory, 'preview-env-request.json'), JSON.stringify(Object.entries(env).map(([key,value]) => ({ key, value, type: key.startsWith('NEXT_PUBLIC_') ? 'encrypted' : 'sensitive', target: ['production'] }))));
console.log(`Prepared ${files.length} app source files and a separate private environment request for tuat-tf-pc-preview.`);
