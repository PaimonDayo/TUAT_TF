import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {serverProfile,wslArgs} from './server-profile.mjs';
const root=resolve(import.meta.dirname,'../..');
const output=resolve(root,'.contingency/local-app.env');
const cloud=parseEnv(readFileSync(resolve(root,'.env.local'),'utf8'));
// Capture only the two local API keys, never print them or export the cloud environment.
const script="const fs=require('fs'),u=require('util');const e=u.parseEnv(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(JSON.stringify({anon:e.ANON_KEY,service:e.SERVICE_ROLE_KEY}));";
const local=JSON.parse(execFileSync('wsl',[...wslArgs(),'node','-e',script,`${serverProfile().stackDir}/.env`],{encoding:'utf8'}));
if(!cloud.SUPABASE_SERVICE_ROLE_KEY||!local.anon||!local.service)throw new Error('Missing required key');
const config={NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:8000',NEXT_PUBLIC_SUPABASE_ANON_KEY:local.anon,SUPABASE_SERVICE_ROLE_KEY:local.service,
 GOOGLE_TOKEN_ENCRYPTION_KEY:cloud.GOOGLE_TOKEN_ENCRYPTION_KEY||createHash('sha256').update(cloud.SUPABASE_SERVICE_ROLE_KEY).digest('hex')};
for(const key of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','R2_READ_ENABLED','R2_WRITE_ENABLED','R2_MAX_STORAGE_BYTES'])if(cloud[key])config[key]=cloud[key];
// Rehearsal must not create/delete cloud images or push to the spreadsheet.
config.IMAGE_STORAGE_READ_ONLY='true';config.R2_UPLOADS_PAUSED='true';config.R2_WRITE_ENABLED='false';
writeFileSync(output,Object.entries(config).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
console.log('Created .contingency/local-app.env; secrets were not displayed. Do not use the normal .env.local for rehearsal.');
