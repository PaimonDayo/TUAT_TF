// Authenticated read-only checks against a loopback-only, pinned build.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { validateConfig } from './run.mjs';
import { writePrivate } from '../laptop/backend-files.mjs';
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const env = parseEnv(readFileSync(config.environmentFile, 'utf8'));
validateConfig(config, env);
if (config.enabled) throw Error('Run preflight before activation');
for (const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE']) if (process.env[k]) env[k]=process.env[k];
const child = spawn(process.execPath, [resolve(config.releaseDirectory,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(config.port)], {cwd:config.releaseDirectory,env:{...env,NODE_ENV:'production'},windowsHide:true,stdio:'ignore'});
const base = `http://127.0.0.1:${config.port}`;
try {
  let ready=false;
  for(let i=0;i<60;i++) {
    if(child.exitCode!==null) throw Error('Local server exited');
    try { const r=await fetch(base+'/api/version',{signal:AbortSignal.timeout(1000)}); if(r.ok&&(await r.json()).version===config.releaseCommit){ready=true;break;} } catch {}
    await new Promise(r=>setTimeout(r,500));
  }
  assert(ready,'Pinned server not ready');
  for(const [path,method] of [['/api/schedule-sheets/cron-sync','POST'],['/api/cron/cleanup-stories','GET']]) {
    const r=await fetch(base+path,{method});assert.equal(r.status,401);
  }
  const paths = process.argv.includes('--records-only') ? [] : ['/api/competition-program/sync'];
  if (!process.argv.includes('--without-records')) paths.push('/api/sheets/sync');
  for(const path of paths) {
    const r=await fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${env.SHEET_SYNC_SECRET}`,'content-type':'application/json'},body:JSON.stringify({dryRun:true}),signal:AbortSignal.timeout(300000)});
    const d=await r.json();
    writePrivate(resolve(config.stateDirectory,`preflight-${path.split('/')[2]}.json`),JSON.stringify(d));
    console.log(JSON.stringify({path,status:r.status,ok:d.ok,failedMembers:d.failedMembers?.length,inserted:d.inserted,updated:d.updated,pushed:d.pushed,results:d.results?.map(v=>({ok:v.ok,rows:v.rows,entries:v.entries,error:!!v.error}))}));
    assert(r.ok&&d.ok===true&&!d.failedMembers?.length,'Dry-run failed; inspect privately');
  }
} finally {
  if(child.exitCode===null) {const done=new Promise(r=>child.once('exit',r));child.kill();await done;}
}
