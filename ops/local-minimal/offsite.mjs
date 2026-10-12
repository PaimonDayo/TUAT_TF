// Explicit encrypted-snapshot transfer only. No timer, migration, deletion or retry.
import { createHash,randomUUID } from 'node:crypto';
import { open,lstat,rename } from 'node:fs/promises';
import { resolve,isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { S3Client,ListObjectsV2Command,PutObjectCommand,HeadObjectCommand,GetObjectCommand } from '@aws-sdk/client-s3';
import { readPrivateFile } from '../pc-backup/config.mjs';

const need=(value)=>{if(!value)throw Error('Encrypted offsite snapshot validation failed');};
async function digest(stream,limit) {
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of stream){bytes+=chunk.length;need(bytes<=limit);hash.update(chunk);}
  return {bytes,sha256:hash.digest('hex')};
}
export async function transferSnapshot(config,{client,now=Date.now,apply=false}={}) {
  need(config.version===1 && typeof config.enabled==='boolean');
  need(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(config.sourceId??'') && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(config.generation??''));
  need(/^\d{10,20}$/.test(config.databaseSystemIdentifier??''));
  for(const name of ['archiveFile','producerReceiptFile','stateDirectory','imageRoot'])need(isAbsolute(config[name]??'')&&resolve(config[name])===config[name]);
  need(Number.isSafeInteger(config.maxArchiveBytes)&&config.maxArchiveBytes>=36&&config.maxArchiveBytes<=16*1024**3);
  need(Number.isSafeInteger(config.maxStorageBytes)&&config.maxStorageBytes>=config.maxArchiveBytes && typeof config.bucket==='string'&&/^[a-z0-9][a-z0-9-]{1,62}$/.test(config.bucket));
  const receipt=JSON.parse(readPrivateFile(config.producerReceiptFile,16384).toString('utf8'));
  need(receipt.version===1 && receipt.sourceId===config.sourceId && receipt.databaseSystemIdentifier===config.databaseSystemIdentifier && receipt.imageRoot===config.imageRoot && receipt.independentRecoveryCopyChecked===true);
  for(const name of ['verifiedAt','restoreVerifiedAt']) {
    const time=Date.parse(receipt[name]);need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(receipt[name]??'')&&Number.isFinite(time)&&time<=now()&&now()-time<35*60_000);
  }
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
    try {await intent.writeFile(JSON.stringify({version:1,state:'unknown',sourceId:config.sourceId,key,sha256:local.sha256,bytes:local.bytes}));await intent.sync();}finally{await intent.close();}
    await send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:archive.createReadStream({start:0,autoClose:false}),ContentLength:entry.size,
      IfNoneMatch:'*',ContentType:'application/octet-stream',Metadata:{sha256:local.sha256}}));
    const head=await send(new HeadObjectCommand({Bucket:config.bucket,Key:key}));
    need(head.ContentLength===entry.size&&head.Metadata?.sha256===local.sha256&&typeof head.ETag==='string'&&head.ETag);
    const result=await send(new GetObjectCommand({Bucket:config.bucket,Key:key,IfMatch:head.ETag}));
    need(result.ContentLength===entry.size&&result.ETag===head.ETag&&result.Metadata?.sha256===local.sha256&&result.Body);
    const remote=await digest(result.Body,entry.size);need(remote.bytes===entry.size&&remote.sha256===local.sha256);
    const after=await archive.stat();need(after.size===info.size&&after.mtimeMs===info.mtimeMs);
    need(now()-Date.parse(receipt.verifiedAt)<35*60_000&&now()-Date.parse(receipt.restoreVerifiedAt)<35*60_000);
    const snapshot={format:'tuat-local-db-images-v1',sourceId:config.sourceId,generation:config.generation,databaseSystemIdentifier:config.databaseSystemIdentifier,
      imageRoot:config.imageRoot,archiveKey:key,archiveSha256:local.sha256,archiveBytes:entry.size,restoreVerifiedAt:new Date(Date.parse(receipt.restoreVerifiedAt)).toISOString(),
      offsiteVerifiedAt:new Date(now()).toISOString(),independentRecoveryCopyChecked:true};
    const target=resolve(config.stateDirectory,'local-snapshot.json'),temporary=resolve(config.stateDirectory,`.verified-${randomUUID()}.json`);
    const verifiedFile=await open(temporary,'wx',0o600);
    try {await verifiedFile.writeFile(JSON.stringify(snapshot,null,2)+'\n');await verifiedFile.sync();} finally {await verifiedFile.close();}
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
