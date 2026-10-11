import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { S3Client,PutObjectCommand,HeadObjectCommand,GetObjectCommand } from '@aws-sdk/client-s3';
import { readPrivateFile } from './config.mjs';
import { sha256 } from './archive.mjs';
import { decryptBackup,verifyRecovery } from '../laptop/backup-backend.mjs';

export async function boundedReadback(body,{expectedBytes,signal,timeoutMilliseconds=30_000}) {
  if(!body?.[Symbol.asyncIterator]||!Number.isSafeInteger(expectedBytes)||expectedBytes<36) throw Error('Invalid backup readback');
  let deadline,rejectAbort,completed=false;
  const close=()=>{try {body.destroy?.();} catch {/* Close best effort after abort. */}try {Promise.resolve(body.cancel?.()).catch(()=>{});} catch {/* Locked web stream. */}};
  const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
  const abort=()=>{close();rejectAbort(Error('Backup readback aborted'));};
  if(signal?.aborted) abort();else signal?.addEventListener('abort',abort,{once:true});
  deadline=setTimeout(abort,timeoutMilliseconds);
  const read=(async()=>{
    const chunks=[];let count=0;
    for await(const chunk of body) {count+=chunk.length;if(count>expectedBytes) throw Error('Oversized backup readback');chunks.push(chunk);}
    if(count!==expectedBytes) throw Error('Incomplete backup readback');
    return Buffer.concat(chunks);
  })();
  try {const bytes=await Promise.race([read,aborted]);completed=true;return bytes;}
  finally {clearTimeout(deadline);signal?.removeEventListener('abort',abort);if(!completed) close();}
}

// Explicit argument transport only: no shell, SSH, sudo, target discovery or old supervisor.
export function createAdapters(config,env,{execute=promisify(execFile),readBinary=readFileSync,createStorage=options=>new S3Client(options)}={}) {
  let commandUncertain=false;
  const commandEnvironment=Object.fromEntries(['SystemRoot','WINDIR','SystemDrive','USERPROFILE','LOCALAPPDATA','APPDATA','TEMP','TMP','PROGRAMDATA']
    .filter(name=>typeof process.env[name]==='string').map(name=>[name,process.env[name]]));
  const run=async(args,{signal,timeout=10_000,maxBuffer=64*1024}={})=>{
    if(commandUncertain) throw Error('Previous command outcome requires reconciliation');
    if(sha256(readBinary(config.wslExecutable))!==config.wslSha256) throw Error('Command pin changed');
    try {
      const {stdout}=await execute(config.wslExecutable,['--distribution',config.wslDistribution,'--user',config.wslUser,'--exec',...args],
        {encoding:'buffer',windowsHide:true,timeout,maxBuffer,signal,env:commandEnvironment});
      return stdout;
    } catch {commandUncertain=true;throw Error('Backup command outcome unverified');}
  };
  const docker=(args,options)=>run([config.dockerExecutable,'--host','unix:///var/run/docker.sock',...args],options);
  const sql=async(statement,signal)=>String(await docker(['exec',config.target.containerId,config.psqlExecutable,'-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-c',statement],{signal,maxBuffer:16*1024*1024,timeout:30_000})).trim();
  let client;
  const storage=()=>client??=createStorage({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},maxAttempts:1,
    requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  const request=(command,signal,ms)=>storage().send(command,{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(ms)])});
  return {
    async probe({signal}) {
      const digest=String(await run(['/usr/bin/sha256sum',config.dockerExecutable],{signal})).trim().split(/\s+/)[0];
      if(digest!==config.dockerSha256) throw Error('Docker command pin changed');
      const format='{{.Id}}|{{.Image}}|{{.Name}}|{{.State.Running}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Source}}{{end}}{{end}}';
      const fields=String(await docker(['inspect','--format',format,config.target.containerId],{signal})).trim().split('|');
      const expected=[config.target.containerId,config.target.containerImageId,`/${config.target.containerName}`,'true',config.target.composeProject,'db',config.target.dataMountSource];
      if(fields.length!==expected.length||fields.some((value,index)=>value!==expected[index])) throw Error('Database container ownership mismatch');
      const identity=await sql("SELECT current_database() || '|' || system_identifier::text FROM pg_control_system();",signal);
      if(identity!==`postgres|${config.target.databaseSystemIdentifier}`) throw Error('Database system identity mismatch');
      return {...config.target};
    },
    async dump({signal}) {
      return docker(['exec',config.target.containerId,config.pgDumpExecutable,'-U','supabase_admin','-d','postgres','--format=custom','--schema=public','--schema=auth','--schema=storage'],{signal,maxBuffer:128*1024*1024,timeout:120_000});
    },
    async recovery({signal}) {
      const vault=JSON.parse(await sql("SELECT COALESCE(json_agg(json_build_object('name',name,'description',description,'secret',decrypted_secret) ORDER BY name),'[]') FROM vault.decrypted_secrets;",signal));
      const installed=await sql("SELECT to_regclass('cron.job') IS NOT NULL;",signal)==='t';
      const jobs=installed?JSON.parse(await sql("SELECT COALESCE(json_agg(to_jsonb(j) ORDER BY jobid),'[]') FROM cron.job j;",signal)):[];
      const pushEnv=config.pushEnvironmentFile===null?null:readPrivateFile(config.pushEnvironmentFile,64*1024).toString('utf8');
      return {version:1,capturedAt:new Date().toISOString(),vault,pushEnv,cron:{installed,jobs}};
    },
    async uploadAndVerify(pair,{signal}) {
      const bucket=env.R2_BUCKET_NAME;
      const etags=[];
      for(const [key,bytes,hash,recovery] of [[pair.key,pair.bytes,pair.sha256,pair.recoveryKey],[pair.recoveryKey,pair.recoveryBytes,pair.recoverySha256,null]]) {
        await request(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:'application/octet-stream',IfNoneMatch:'*',Metadata:{sha256:hash,...(recovery?{recovery}:{})}}),signal,30_000);
        const head=await request(new HeadObjectCommand({Bucket:bucket,Key:key}),signal,10_000);
        if(head.ContentLength!==bytes.length||head.Metadata?.sha256!==hash||typeof head.ETag!=='string'||!head.ETag||head.ETag.length>256||/[\r\n\0]/.test(head.ETag)) throw Error('Remote encrypted pair verification failed');
        const downloaded=await request(new GetObjectCommand({Bucket:bucket,Key:key}),signal,30_000);
        // Keep readback bounded by the exact uploaded ciphertext size, including streamed bodies.
        if(downloaded.ContentLength!==bytes.length||downloaded.ETag!==head.ETag) {downloaded.Body?.destroy?.();throw Error('Remote backup size or identity mismatch');}
        const actual=await boundedReadback(downloaded.Body,{expectedBytes:bytes.length,signal});
        if(actual.length!==bytes.length||sha256(actual)!==hash||downloaded.Metadata?.sha256!==hash) throw Error('Remote backup readback mismatch');
        etags.push(head.ETag);
      }
      const dump=decryptBackup(pair.bytes,env.PC_BACKUP_ENCRYPTION_KEY);
      verifyRecovery(decryptBackup(pair.recoveryBytes,env.PC_BACKUP_ENCRYPTION_KEY),dump,config.instanceId);
      return {verified:true,dumpEtag:etags[0],recoveryEtag:etags[1]};
    },
    isDrained(){return !commandUncertain;},
    close(){client?.destroy();}
  };
}
