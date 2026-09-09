// Build with the already-approved PC production settings, without printing secrets.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
const env={...process.env};
for (const file of ['.env','.env.local','.env.production','.env.production.local']) {
  const path=resolve(root,file);
  if (existsSync(path)) for (const key of Object.keys(parseEnv(readFileSync(path,'utf8')))) env[key]='';
}
for (const key of Object.keys(env)) if (/^(SUPABASE_|NEXT_PUBLIC_|GOOGLE_|SHEET_|GAS_|VAPID_|R2_|CLOUDFLARE_|VERCEL_|CRON_|LEGACY_|PC_)/.test(key)) env[key]='';
const settings=JSON.parse(readFileSync(resolve(root,'.contingency/backend/vercel-env.json'),'utf8'));
if(settings.PC_BACKEND_ENABLED!=='true'||settings.NEXT_PUBLIC_SUPABASE_URL!=='https://tuat-tf.vercel.app/api/pc-supabase') throw Error('Expected current PC production configuration');
Object.assign(env,settings,{NODE_ENV:'production',VERCEL:'1',VERCEL_ENV:'production'});
const child=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'build'],{cwd:root,env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>{process.exitCode=code??1;});
