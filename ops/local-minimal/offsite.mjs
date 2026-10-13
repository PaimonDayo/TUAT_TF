// Explicit encrypted-snapshot transfer only. No timer, migration, deletion or retry.
import { createHash,randomUUID } from 'node:crypto';
import { open,lstat,rename } from 'node:fs/promises';
import { resolve,isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { S3Client,ListObjectsV2Command,PutObjectCommand,HeadObjectCommand,GetObjectCommand } from '@aws-sdk/client-s3';
import { readPrivateFile,validateBackupProfile,backupTargetFingerprint } from '../pc-backup/config.mjs';
import { utcTime,HEARTBEAT_MAX_AGE_MS,BACKUP_MAX_AGE_MS,STATUS_FILE } from '../pc-backup/status.mjs';

const need=(value)=>{if(!value)throw Error('Encrypted offsite snapshot validation failed');};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const rootActor=()=>need(process.platform==='linux'&&process.getuid()===0);
const absolute=value=>isAbsolute(value??'')&&resolve(value)===value;
/** Only the root-owned active host can bind a PC snapshot to a lifecycle. */
export function activePcSnapshotHost(config,{read=readPrivateFile,assertRoot=rootActor,now=Date.now}={}) {
  assertRoot();need(absolute(config.hostConfigFile));
  const json=path=>JSON.parse(read(path,16384).toString('utf8'));
  const host=json(config.hostConfigFile);need(host.version===1&&host.enabled===true&&absolute(host.stateDirectory)&&absolute(host.backupConfigFile));
  const backup=json(host.backupConfigFile),runtime=json(resolve(host.stateDirectory,'runtime-status.json'));
  need(validateBackupProfile(backup)&&backup.enabled===true&&backup.instanceId===config.sourceId&&backup.target.sourceLabel===config.sourceId
    &&backup.target.databaseSystemIdentifier===config.databaseSystemIdentifier&&backup.localImageRoot===config.imageRoot
    &&backup.localSnapshotReceiptFile===resolve(config.stateDirectory,'local-snapshot.json')
    &&host.expectedBackupInstanceId===config.sourceId&&host.expectedBackupDatabaseSystemIdentifier===config.databaseSystemIdentifier
    &&host.expectedBackupDatabaseName===backup.target.databaseName&&host.applicationUid===65530&&host.applicationGid===65530);
  const identity=runtime.backup?.identity,clock=now(),started=utcTime(identity?.startedAt),checked=utcTime(runtime.checkedAt);
  need(Number.isFinite(clock)&&runtime.version===1&&runtime.running===true&&uuid(identity?.generation)
    &&identity.instanceId===config.sourceId&&identity.databaseSystemIdentifier===config.databaseSystemIdentifier&&identity.databaseName===backup.target.databaseName
    &&runtime.startedAt===identity.startedAt&&Number.isFinite(started)&&started<=clock&&Number.isFinite(checked)&&checked>=started&&checked<=clock&&clock-checked<HEARTBEAT_MAX_AGE_MS
    &&/^[a-f0-9]{40}$/.test(host.releaseCommit??'')&&typeof host.releaseId==='string'&&host.releaseId
    &&runtime.releaseCommit===host.releaseCommit&&runtime.releaseId===host.releaseId
    &&runtime.backup.statusPath===resolve(backup.applicationStatusDirectory??backup.stateDirectory,STATUS_FILE));
  return {generation:identity.generation,startedAt:identity.startedAt,databaseName:backup.target.databaseName,releaseCommit:host.releaseCommit,
    releaseId:host.releaseId,targetFingerprint:backupTargetFingerprint(backup),hostConfigFile:config.hostConfigFile,backupConfigFile:host.backupConfigFile,
    hostStateDirectory:host.stateDirectory,receiptPath:backup.localSnapshotReceiptFile,statusPath:runtime.backup.statusPath};
}
async function digest(stream,limit) {
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of stream){bytes+=chunk.length;need(bytes<=limit);hash.update(chunk);}
  return {bytes,sha256:hash.digest('hex')};
}
export async function transferSnapshot(config,{client,now=Date.now,apply=false,read=readPrivateFile,assertRoot=rootActor}={}) {
  need(config.version===1 && typeof config.enabled==='boolean');
  need(uuid(config.sourceId)&&(config.profile===undefined||config.profile==='pc-private')&&(config.profile==='pc-private'||uuid(config.generation)));
  need(/^\d{10,20}$/.test(config.databaseSystemIdentifier??''));
  for(const name of ['archiveFile','producerReceiptFile','stateDirectory'])need(absolute(config[name]));
  need(config.profile==='pc-private'?config.imageRoot==='/var/lib/tuat-local/images':absolute(config.imageRoot));
  need(Number.isSafeInteger(config.maxArchiveBytes)&&config.maxArchiveBytes>=36&&config.maxArchiveBytes<=16*1024**3);
  need(Number.isSafeInteger(config.maxStorageBytes)&&config.maxStorageBytes>=config.maxArchiveBytes && typeof config.bucket==='string'&&/^[a-z0-9][a-z0-9-]{1,62}$/.test(config.bucket));
  const binding=config.profile==='pc-private'?activePcSnapshotHost(config,{read,assertRoot,now}):null;
  const recheck=()=>{if(binding)need(JSON.stringify(activePcSnapshotHost(config,{read,assertRoot,now}))===JSON.stringify(binding));};
  const receipt=JSON.parse(read(config.producerReceiptFile,16384).toString('utf8'));
  need(receipt.version===1 && receipt.sourceId===config.sourceId && receipt.databaseSystemIdentifier===config.databaseSystemIdentifier && receipt.imageRoot===config.imageRoot && receipt.independentRecoveryCopyChecked===true);
  for(const name of ['verifiedAt','restoreVerifiedAt']) {
    const time=Date.parse(receipt[name]);need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(receipt[name]??'')&&Number.isFinite(time)&&time<=now()&&now()-time<35*60_000);
  }
  const capturedAt=new Date(Date.parse(receipt.verifiedAt)).toISOString(),restoreVerifiedAt=new Date(Date.parse(receipt.restoreVerifiedAt)).toISOString();
  need(Date.parse(capturedAt)<=Date.parse(restoreVerifiedAt)&&(!binding||Date.parse(capturedAt)>=utcTime(binding.startedAt)));
  const entry=await lstat(config.archiveFile);need(entry.isFile()&&!entry.isSymbolicLink()&&entry.nlink===1&&entry.size>=36&&entry.size<=config.maxArchiveBytes);
  if(process.platform!=='win32')need((entry.mode&0o077)===0&&entry.uid===process.getuid());
  const archive=await open(config.archiveFile,'r');
  try {
    const info=await archive.stat();need(info.ino===entry.ino&&info.dev===entry.dev&&info.size===entry.size&&info.nlink===1);
    const header=Buffer.alloc(8);await archive.read(header,0,8,0);need(header.toString()==='TUATPC01');
    const local=await digest(archive.createReadStream({start:0,autoClose:false}),entry.size);
    need(local.bytes===entry.size && local.sha256===receipt.archiveSha256);
    const stamp=new Date(Date.parse(receipt.verifiedAt)).toISOString().replace(/[:.]/g,'-'),prefix=`ops/pc-backend/${config.sourceId}/backups/`,key=`${prefix}${stamp}.local.tar.enc`;
    if(!apply)return {valid:true,executed:false,sourceId:config.sourceId,bytes:entry.size,key};
    need(config.enabled===true && client);
    const state=await lstat(config.stateDirectory);need(state.isDirectory()&&!state.isSymbolicLink());
    if(process.platform!=='win32')need((state.mode&0o077)===0&&state.uid===process.getuid());
    const signal=AbortSignal.timeout(120000);const send=command=>client.send(command,{abortSignal:signal});
    let total=0,count=0,token;const tokens=new Set();let complete=false;
    for(let page=0;page<100;page++) {
      // Capacity includes old images/backups and every other key in this bucket.
      const result=await send(new ListObjectsV2Command({Bucket:config.bucket,MaxKeys:1000,...(token?{ContinuationToken:token}:{})}));
      need(Array.isArray(result.Contents??[]) && typeof result.IsTruncated==='boolean');
      for(const object of result.Contents??[]) {need(typeof object.Key==='string'&&object.Key&&Number.isSafeInteger(object.Size)&&object.Size>=0);total+=object.Size;count++;need(count<=10000&&Number.isSafeInteger(total));}
      if(!result.IsTruncated){complete=true;break;}
      need(typeof result.NextContinuationToken==='string'&&result.NextContinuationToken&&!tokens.has(result.NextContinuationToken));token=result.NextContinuationToken;tokens.add(token);
    }
    need(complete&&total+entry.size<=config.maxStorageBytes);
    // Unknown attempts remain held; never overwrite an intent or automatically resend it.
    const intentPath=resolve(config.stateDirectory,`${stamp}.offsite-intent.json`);
    const intent=await open(intentPath,'wx',0o600);
    try {await intent.writeFile(JSON.stringify({version:1,state:'unknown',sourceId:config.sourceId,generation:binding?.generation??config.generation,
      ...(binding?{startedAt:binding.startedAt}:{}),capturedAt,restoreVerifiedAt,key,sha256:local.sha256,bytes:local.bytes}));await intent.sync();}finally{await intent.close();}
    recheck();
    await send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:archive.createReadStream({start:0,autoClose:false}),ContentLength:entry.size,
      IfNoneMatch:'*',ContentType:'application/octet-stream',Metadata:{sha256:local.sha256}}));
    const head=await send(new HeadObjectCommand({Bucket:config.bucket,Key:key}));
    need(head.ContentLength===entry.size&&head.Metadata?.sha256===local.sha256&&typeof head.ETag==='string'&&head.ETag);
    const result=await send(new GetObjectCommand({Bucket:config.bucket,Key:key,IfMatch:head.ETag}));
    need(result.ContentLength===entry.size&&result.ETag===head.ETag&&result.Metadata?.sha256===local.sha256&&result.Body);
    const remote=await digest(result.Body,entry.size);need(remote.bytes===entry.size&&remote.sha256===local.sha256);
    const after=await archive.stat();need(after.size===info.size&&after.mtimeMs===info.mtimeMs);
    const finished=now();need(Number.isFinite(finished)&&[capturedAt,restoreVerifiedAt].every(value=>Date.parse(value)<=finished&&finished-Date.parse(value)<BACKUP_MAX_AGE_MS));
    recheck();
    const snapshot={format:'tuat-local-db-images-v1',sourceId:config.sourceId,generation:binding?.generation??config.generation,databaseSystemIdentifier:config.databaseSystemIdentifier,
      imageRoot:config.imageRoot,archiveKey:key,archiveSha256:local.sha256,archiveBytes:entry.size,capturedAt,restoreVerifiedAt,
      offsiteVerifiedAt:new Date(finished).toISOString(),independentRecoveryCopyChecked:true};
    const target=resolve(config.stateDirectory,'local-snapshot.json'),temporary=resolve(config.stateDirectory,`.verified-${randomUUID()}.json`);
    const verifiedFile=await open(temporary,'wx',0o600);
    try {await verifiedFile.writeFile(JSON.stringify(snapshot,null,2)+'\n');await verifiedFile.sync();} finally {await verifiedFile.close();}
    recheck();need(finished<=now());
    await rename(temporary,target);
    if(process.platform!=='win32') {const directory=await open(config.stateDirectory,'r');try{await directory.sync();}finally{await directory.close();}}
    return {verified:true,sourceId:config.sourceId,receipt:target};
  } finally {await archive.close();}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  let client;
  try {
    const [file,flag]=process.argv.slice(2);need(file&&(!flag||flag==='--apply')&&process.argv.length<=4);
    const config=JSON.parse(readPrivateFile(file,16384).toString('utf8'));
    if(flag==='--apply') {
      const env=parseEnv(readPrivateFile(config.environmentFile,16384).toString('utf8'));
      need(/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID??'')&&env.R2_ACCESS_KEY_ID&&env.R2_SECRET_ACCESS_KEY);
      client=new S3Client({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
    }
    console.log(JSON.stringify(await transferSnapshot(config,{client,apply:flag==='--apply'})));
  } catch {console.error('Off-PC snapshot was not accepted; retain the prior receipt and inspect the private intent.');process.exitCode=1;}
  finally {client?.destroy();}
}
