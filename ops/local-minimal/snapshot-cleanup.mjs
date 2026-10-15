// Explicit combined-snapshot reclaim. No timer, credentials, retries or import-time I/O.
import {createHash,randomUUID} from 'node:crypto';
import {constants,realpathSync} from 'node:fs';
import {open,lstat,readdir,mkdir,rename,unlink,rmdir} from 'node:fs/promises';
import {resolve,dirname,basename,isAbsolute} from 'node:path';
import {parseEnv} from 'node:util';
import {ListObjectsV2Command,HeadObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {activePcSnapshotHost} from './offsite.mjs';
import {readPrivateFile} from '../pc-backup/config.mjs';
import {MAX_RETENTION_INVENTORY} from '../pc-backup/retention.mjs';
import {planSnapshotRetention,verifiedSnapshotReceipt} from './snapshot-retention.mjs';

const ROOT='/var/lib/tuat-local/backup',MAX_AGE=15*60_000;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesDigest=value=>createHash('sha256').update(value).digest('hex');
const need=(condition,message='Snapshot cleanup proof unavailable')=>{if(!condition)throw Error(message);};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const absolute=value=>typeof value==='string'&&isAbsolute(value)&&resolve(value)===value;
const absent=error=>error?.code==='ENOENT'||error?.name==='NotFound'||error?.$metadata?.httpStatusCode===404;
const statProof=s=>({dev:String(s.dev),ino:String(s.ino),nlink:s.nlink,bytes:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs});
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.nlink===1&&b.nlink===1&&a.bytes===b.bytes&&a.mtimeMs===b.mtimeMs;
const pointerFields=['format','sourceId','generation','databaseSystemIdentifier','imageRoot','archiveKey','archiveSha256',
  'archiveBytes','capturedAt','restoreVerifiedAt','offsiteVerifiedAt','independentRecoveryCopyChecked'];
const pointerOf=r=>Object.fromEntries(pointerFields.map(key=>[key,r[key]]));
const operations=value=>{
  const plan=value.plan??value;
  return [...['remote','local'].flatMap(location=>plan[location].removalCandidates.map(snapshot=>({location,...snapshot}))),...(value.metadataCandidates??[])];
};
const operationId=op=>`${op.location}.${op.receiptDigest}`;
const journalName='snapshot-cleanup-journal.json';

const matchesIntent=(record,snapshot)=>record?.version===1&&record.state==='unknown'&&record.sourceId===snapshot.sourceId
  &&record.generation===snapshot.generation&&record.key===snapshot.archiveKey&&record.sha256===snapshot.archiveSha256
  &&record.bytes===snapshot.archiveBytes&&record.capturedAt===snapshot.capturedAt&&record.restoreVerifiedAt===snapshot.restoreVerifiedAt;

/** Completed-pair metadata only. An observed absence without a durable retirement
 * result is never proof that a deletion succeeded. Future known results in this
 * same reviewed plan may qualify, but are checked again before any unlink. */
export function planCompletedSnapshotMetadata(captured,plan,config,{readJson}={}) {
  const candidates=[];
  for(const snapshot of captured.snapshots) {
    if(snapshot.archiveKey===captured.protectedSnapshot.archiveKey)continue;
    const retired=captured.proof.retirements.find(item=>item.receiptDigest===digest(snapshot));
    if(!retired)continue;
    const gone=location=>retired[`${location}Deleted`]||plan[location].removalCandidates.some(item=>item.archiveKey===snapshot.archiveKey);
    if(!gone('local')||!gone('remote'))continue;
    const history=captured.claims.filter(item=>item.name.endsWith('.offsite-verified.json')&&item.record?.archiveKey===snapshot.archiveKey);
    const intents=captured.claims.filter(item=>item.name.endsWith('.offsite-intent.json')&&item.record?.key===snapshot.archiveKey);
    if(history.length!==1||intents.length!==1||!matchesIntent(intents[0].record,snapshot)
      ||digest(verifiedSnapshotReceipt(history[0].record,captured.identity,Date.parse(plan.binding.plannedAt)))!==digest(snapshot))continue;
    const names=new Set([history[0].name,intents[0].name]);
    for(const file of captured.stateFiles)if(/^producer-(?:[a-f0-9]{32}|[a-f0-9-]{36})\.json$/.test(file.name)) {
      const invocation=readJson(file.path);
      if(invocation.archiveFile===snapshot.localArchiveFile&&['profile','sourceId','databaseSystemIdentifier','imageRoot','environmentFile','hostConfigFile','stateDirectory','bucket'].every(key=>invocation[key]===config[key]))names.add(file.name);
    }
    const files=captured.stateFiles.filter(file=>names.has(file.name));if(files.length!==names.size)continue;
    candidates.push({location:'metadata',receiptDigest:digest(snapshot),archiveKey:snapshot.archiveKey,localArchiveFile:snapshot.localArchiveFile,files,
      retirementFile:resolve(config.stateDirectory,`${snapshot.capturedAt.replace(/[:.]/g,'-')}.snapshot-retired.json`)});
  }
  return candidates;
}

async function syncDirectory(path) {
  if(process.platform==='win32')return;
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{await fd.sync();}finally{await fd.close();}
}
async function privateDirectory(path) {
  need(absolute(path));const entry=await lstat(path);
  need(entry.isDirectory()&&!entry.isSymbolicLink()&&realpathSync(path)===path,'Private snapshot directory redirected');
  if(process.platform!=='win32')need(entry.uid===process.getuid()&&(entry.mode&0o077)===0,'Private snapshot directory required');
  return statProof(entry);
}
async function privateEntry(path) {
  const entry=await lstat(path);
  need(entry.isFile()&&!entry.isSymbolicLink()&&entry.nlink===1,'Private single-link snapshot required');
  if(process.platform!=='win32')need(entry.uid===process.getuid()&&(entry.mode&0o077)===0,'Private snapshot owner required');
  return statProof(entry);
}
async function writeNew(path,value) {
  await privateDirectory(dirname(path));const fd=await open(path,'wx',0o600);
  try{await fd.writeFile(JSON.stringify(value)+'\n');await fd.sync();}finally{await fd.close();}
  await syncDirectory(dirname(path));
}
async function writeReplace(path,value) {
  const temp=resolve(dirname(path),`.snapshot-cleanup-write-${randomUUID()}.json`);
  await writeNew(temp,value);
  try{await privateEntry(path);}catch(error){if(!absent(error))throw error;}
  await rename(temp,path);await syncDirectory(dirname(path));
}
export const writeSnapshotCleanupOutcome=(config,value)=>writeReplace(resolve(config.stateDirectory,'snapshot-cleanup-outcome.json'),value);

/** Hash an already scoped file through O_NOFOLLOW and recheck inode, device and
 * link count on both its descriptor and its name. Exported for native-file tests. */
async function verifyPrivateContent(path,snapshot,expected,ciphertext=true) {
  await privateDirectory(dirname(path));const before=await privateEntry(path);
  if(expected)need(sameFile(before,expected)&&before.ctimeMs===expected.ctimeMs,'Local snapshot identity changed');
  need(before.bytes===snapshot.archiveBytes,'Local snapshot size changed');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    need(sameFile(statProof(await fd.stat()),before),'Local snapshot descriptor changed');
    const hash=createHash('sha256');let count=0,header=Buffer.alloc(0);
    for await(const chunk of fd.createReadStream({start:0,autoClose:false})) {
      if(header.length<8)header=Buffer.concat([header,chunk.subarray(0,8-header.length)]);
      count+=chunk.length;need(count<=snapshot.archiveBytes,'Local snapshot exceeds receipt');hash.update(chunk);
    }
    const after=statProof(await fd.stat()),named=await privateEntry(path);
    need((!ciphertext||header.toString()==='TUATPC01')&&count===snapshot.archiveBytes&&hash.digest('hex')===snapshot.archiveSha256,'Local ciphertext hash changed');
    need(sameFile(after,before)&&sameFile(named,before)&&after.ctimeMs===before.ctimeMs&&named.ctimeMs===before.ctimeMs,'Local snapshot changed during hash');
    return before;
  } finally {await fd.close();}
}
export const verifySnapshotCiphertext=(path,snapshot,expected)=>verifyPrivateContent(path,snapshot,expected,true);

/** Same-filesystem private quarantine prevents a pathname exchange from causing
 * a different inode to be unlinked. Every failure leaves the staged file for
 * inspection. The caller persists its unknown intent before calling this. */
async function removeCheckedFile(snapshot,{archiveRoot,expected,nonce,assertFresh,ciphertext=true}={}) {
  need(absolute(archiveRoot)&&dirname(snapshot.localArchiveFile)===archiveRoot
    &&(!ciphertext||/^snapshot-[a-f0-9]{16}\.tar\.enc$/.test(basename(snapshot.localArchiveFile)))&&uuid(nonce)&&typeof assertFresh==='function','Scoped local snapshot required');
  const verified=await verifyPrivateContent(snapshot.localArchiveFile,snapshot,expected,ciphertext);await assertFresh();
  const quarantine=resolve(archiveRoot,`.snapshot-cleanup-${nonce}`),target=resolve(quarantine,basename(snapshot.localArchiveFile));
  try{await mkdir(quarantine,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const directory=await privateDirectory(quarantine);need(directory.dev===verified.dev,'Quarantine must be on the same filesystem');
  let exists=false;try{await lstat(target);exists=true;}catch(error){if(!absent(error))throw error;}need(!exists,'Quarantined snapshot already exists');
  await rename(snapshot.localArchiveFile,target);await syncDirectory(archiveRoot);await syncDirectory(quarantine);
  const staged=await privateEntry(target);need(sameFile(staged,verified),'Moved snapshot identity changed; quarantine retained');
  let sourceExists=false;try{await lstat(snapshot.localArchiveFile);sourceExists=true;}catch(error){if(!absent(error))throw error;}
  need(!sourceExists,'Snapshot name reused; quarantine retained');
  await verifyPrivateContent(target,snapshot,staged,ciphertext);await assertFresh();
  const final=await privateEntry(target);need(sameFile(final,staged)&&final.ctimeMs===staged.ctimeMs,'Quarantine changed');
  await unlink(target);await syncDirectory(quarantine);await rmdir(quarantine);await syncDirectory(archiveRoot);
}
export const removeSnapshotCiphertext=(snapshot,options)=>removeCheckedFile(snapshot,{...options,ciphertext:true});

async function remoteCiphertext(client,bucket,snapshot) {
  const send=command=>client.send(command,{abortSignal:AbortSignal.timeout(120_000)});
  const head=await send(new HeadObjectCommand({Bucket:bucket,Key:snapshot.archiveKey,IfMatch:snapshot.objectEtag}));
  const matches=value=>value.ContentLength===snapshot.archiveBytes&&value.ETag===snapshot.objectEtag&&value.Metadata?.sha256===snapshot.archiveSha256;
  need(matches(head),'Remote snapshot HEAD changed');
  const response=await send(new GetObjectCommand({Bucket:bucket,Key:snapshot.archiveKey,IfMatch:snapshot.objectEtag}));
  need(matches(response)&&response.Body,'Remote snapshot read changed');
  const hash=createHash('sha256');let count=0,header=Buffer.alloc(0);
  for await(const chunk of response.Body){if(header.length<8)header=Buffer.concat([header,chunk.subarray(0,8-header.length)]);
    count+=chunk.length;need(count<=snapshot.archiveBytes,'Remote snapshot exceeds receipt');hash.update(chunk);}
  need(header.toString()==='TUATPC01'&&count===snapshot.archiveBytes&&hash.digest('hex')===snapshot.archiveSha256,'Remote ciphertext hash changed');
}

/** Native adapter. conditionalDeleteSupported must come from a provider proof for
 * this client/endpoint. An SDK parameter alone does not establish that ability.
 * The client must use maxAttempts:1; unknown DELETEs must never be retried by it. */
export async function createSnapshotCleanupAdapter(config,{client,conditionalDeleteSupported=false,immutableSourceNamespace=false,assertExclusiveLifecycleWriter,verifyRetainedRecovery,
  now=Date.now,read=readPrivateFile,assertRoot}={}) {
  need(config?.version===1&&config.profile==='pc-private'&&config.enabled===true&&client,'Enabled dedicated PC snapshot cleanup required');
  need(config.imageRoot==='/var/lib/tuat-local/images'&&absolute(config.stateDirectory)&&absolute(config.environmentFile),'Dedicated snapshot paths required');
  need(typeof verifyRetainedRecovery==='function','Retained recovery verifier required');
  need(typeof client.config?.maxAttempts==='function'&&await client.config.maxAttempts()===1,'Cleanup storage client must disable retries');
  const host=()=>activePcSnapshotHost(config,{read,...(assertRoot?{assertRoot}:{}),now});
  const boundHost=host(),environment=read(config.environmentFile,16384),env=parseEnv(environment.toString('utf8'));
  need(/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID??'')&&env.R2_BUCKET_NAME===config.bucket&&/^[a-f0-9]{64}$/.test(env.PC_BACKUP_ENCRYPTION_KEY??''),'Dedicated storage scope required');
  need(typeof client.config.endpoint==='function','Pinned R2 endpoint required');
  const endpoint=await client.config.endpoint();
  need(endpoint?.protocol==='https:'&&endpoint.hostname===`${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    &&(!endpoint.port||endpoint.port===443)&&(!endpoint.path||endpoint.path==='/')&&!endpoint.query,'Cleanup client storage endpoint mismatch');
  const identity={sourceId:config.sourceId,storageScopeId:digest({account:env.R2_ACCOUNT_ID,bucket:config.bucket}),
    archiveKeyId:bytesDigest(Buffer.from(env.PC_BACKUP_ENCRYPTION_KEY,'hex')),databaseSystemIdentifier:config.databaseSystemIdentifier,
    generation:boundHost.generation,startedAt:boundHost.startedAt};
  const prefix=`ops/pc-backend/${config.sourceId}/backups/`;
  const lifecycleProof=async()=>{
    need(immutableSourceNamespace===true&&typeof assertExclusiveLifecycleWriter==='function','Immutable namespace owner proof required');
    const proof=await assertExclusiveLifecycleWriter({identity:{...identity},prefix});
    need(proof?.exclusive===true&&proof.sourceId===identity.sourceId&&proof.storageScopeId===identity.storageScopeId
      &&proof.generation===identity.generation&&proof.prefix===prefix&&typeof proof.ownerToken==='string'
      &&proof.ownerToken.length>=16&&proof.ownerToken.length<=256,'Exclusive snapshot lifecycle writer unavailable');
    return {exclusive:true,sourceId:proof.sourceId,storageScopeId:proof.storageScopeId,generation:proof.generation,prefix,ownerToken:proof.ownerToken};
  };
  const namespaceProof=immutableSourceNamespace===true?await lifecycleProof():null;
  const deletionMode=conditionalDeleteSupported===true?'if-match':namespaceProof?'immutable-source-namespace':'unavailable';
  const binding=digest({config,host:boundHost,environment:bytesDigest(environment),deletionMode,namespaceProof});
  const send=command=>client.send(command,{abortSignal:AbortSignal.timeout(120_000)});
  const recheck=async()=>{
    need(digest(host())===digest(boundHost)&&read(config.environmentFile,16384).equals(environment),'Active host or storage scope changed');
    if(namespaceProof)need(digest(await lifecycleProof())===digest(namespaceProof),'Snapshot lifecycle lock changed');
    await privateDirectory(config.stateDirectory);await privateDirectory(ROOT);
  };
  const json=path=>JSON.parse(read(path,128*1024).toString('utf8'));
  const checkpointPath=resolve(config.stateDirectory,journalName);
  const retirementPath=snapshot=>resolve(config.stateDirectory,`${snapshot.capturedAt.replace(/[:.]/g,'-')}.snapshot-retired.json`);
  const retirement=(snapshot,localDeleted=false,remoteDeleted=false)=>({version:1,receiptDigest:digest(snapshot),archiveKey:snapshot.archiveKey,
    storageScopeId:identity.storageScopeId,archiveKeyId:identity.archiveKeyId,sourceId:identity.sourceId,databaseSystemIdentifier:identity.databaseSystemIdentifier,
    localArchiveFile:snapshot.localArchiveFile,localDeleted,remoteDeleted});
  const readCheckpoint=()=>{try{return json(checkpointPath);}catch(error){if(!absent(error))throw error;return null;}};
  async function capture() {
    await recheck();const beforeState=await privateDirectory(config.stateDirectory),beforeLocal=await privateDirectory(ROOT);
    const stateNames=(await readdir(config.stateDirectory)).sort(),metadata=[],snapshots=[],claims=[],stateFiles=[];
    need(stateNames.length<=MAX_RETENTION_INVENTORY*4,'State inventory limit exceeded');
    for(const name of stateNames) {
      const file=resolve(config.stateDirectory,name),entry=await lstat(file);
      if(entry.isDirectory()&&/^\.snapshot-cleanup-[a-f0-9-]{36}$/.test(name)) {
        await privateDirectory(file);need((await readdir(file)).length===0,'Quarantined snapshot metadata requires inspection');continue;
      }
      const proof=await privateEntry(file);
      if(name==='snapshot-cleanup.lock'||name===journalName||name==='snapshot-cleanup-outcome.json') {
        if(name===journalName)need(readCheckpoint()?.pending===null,'Unresolved snapshot deletion requires inspection');
        continue;
      }
      const data=read(file,128*1024),sha256=bytesDigest(data);
      stateFiles.push({name,path:file,sha256,...proof});
      if(!name.endsWith('.snapshot-retired.json'))metadata.push({name,sha256});
      if(name.endsWith('.offsite-verified.json')||name.endsWith('.offsite-intent.json')) {
        let record;try{record=JSON.parse(data.toString('utf8'));}catch{throw Error('Snapshot receipt or PUT intent unreadable');}
        claims.push({name,record});
        if(!name.endsWith('.offsite-verified.json'))continue;
        const verified=verifiedSnapshotReceipt(record,identity,now());
        if(verified)snapshots.push(verified);
      }
    }
    need(snapshots.length<=MAX_RETENTION_INVENTORY,'Receipt inventory limit exceeded');
    for(const {name,record} of claims)for(const snapshot of snapshots) {
      if(record?.archiveKey!==snapshot.archiveKey&&record?.key!==snapshot.archiveKey&&record?.localArchiveFile!==snapshot.localArchiveFile)continue;
      if(name.endsWith('.offsite-verified.json'))need(digest(verifiedSnapshotReceipt(record,identity,now()))===digest(snapshot),'Conflicting snapshot receipt held');
      else need(matchesIntent(record,snapshot),'Unresolved conflicting PUT intent held');
    }
    const current=json(resolve(config.stateDirectory,'local-snapshot.json'));
    need(Object.keys(current).sort().join(',')===[...pointerFields].sort().join(','),'Current snapshot pointer changed');
    const currentMatches=snapshots.filter(record=>digest(pointerOf(record))===digest(pointerOf(current)));
    need(currentMatches.length===1,'Current snapshot is missing a complete verified receipt');
    const localFiles=[];
    for(const name of (await readdir(ROOT)).sort()) {
      const file=resolve(ROOT,name),entry=await lstat(file);
      if(entry.isDirectory()&&/^\.snapshot-cleanup-[a-f0-9-]{36}$/.test(name)) {
        await privateDirectory(file);need((await readdir(file)).length===0,'Quarantined snapshot requires inspection');continue;
      }
      localFiles.push({path:file,...await privateEntry(file)});
      need(localFiles.length<=MAX_RETENTION_INVENTORY,'Local inventory limit exceeded');
    }
    const remoteObjects=[];let token,complete=false;const tokens=new Set();
    for(let page=0;page<100;page++) {
      const response=await send(new ListObjectsV2Command({Bucket:config.bucket,Prefix:prefix,MaxKeys:1000,...(token?{ContinuationToken:token}:{})}));
      need(Array.isArray(response.Contents??[])&&typeof response.IsTruncated==='boolean','Remote inventory incomplete');
      for(const object of response.Contents??[]) {
        need(typeof object.Key==='string'&&object.Key.startsWith(prefix)&&Number.isSafeInteger(object.Size)&&object.Size>=0
          &&typeof object.ETag==='string'&&object.ETag.length>0&&!/[\r\n\0]/.test(object.ETag),'Remote inventory object unverified');
        remoteObjects.push({key:object.Key,bytes:object.Size,etag:object.ETag});
        need(remoteObjects.length<=MAX_RETENTION_INVENTORY,'Remote inventory limit exceeded');
      }
      if(!response.IsTruncated){complete=true;break;}
      need(typeof response.NextContinuationToken==='string'&&response.NextContinuationToken&&!tokens.has(response.NextContinuationToken),'Remote inventory continuation unverified');
      token=response.NextContinuationToken;tokens.add(token);
    }
    need(complete&&new Set(remoteObjects.map(object=>object.key)).size===remoteObjects.length,'Remote inventory incomplete or duplicated');
    remoteObjects.sort((a,b)=>a.key.localeCompare(b.key));
    const local=new Map(localFiles.map(file=>[file.path,file])),remote=new Map(remoteObjects.map(object=>[object.key,object]));
    const availability={local:[],remote:[]},retirements=[];
    for(const snapshot of snapshots) {
      const file=local.get(snapshot.localArchiveFile),object=remote.get(snapshot.archiveKey);
      if(file){need(file.bytes===snapshot.archiveBytes,'Local receipt size mismatch');availability.local.push(snapshot.archiveKey);}
      if(object){need(object.bytes===snapshot.archiveBytes&&object.etag===snapshot.objectEtag,'Remote receipt identity mismatch');availability.remote.push(snapshot.archiveKey);}
      let retired;try{retired=json(retirementPath(snapshot));}catch(error){if(!absent(error))throw error;retired=retirement(snapshot);}
      need(typeof retired.localDeleted==='boolean'&&typeof retired.remoteDeleted==='boolean'
        &&digest(retired)===digest(retirement(snapshot,retired.localDeleted,retired.remoteDeleted)),'Snapshot retirement proof changed');
      need(!(file&&retired.localDeleted)&&!(object&&retired.remoteDeleted),'Retired snapshot unexpectedly reappeared');retirements.push(retired);
    }
    const retirementNames=new Set(snapshots.map(snapshot=>basename(retirementPath(snapshot))));
    for(const file of stateFiles)if(file.name.endsWith('.snapshot-retired.json')&&!retirementNames.has(file.name))metadata.push({name:file.name,sha256:file.sha256});
    metadata.sort((a,b)=>a.name.localeCompare(b.name));
    const afterState=await privateDirectory(config.stateDirectory),afterLocal=await privateDirectory(ROOT);
    need(digest(beforeState)===digest(afterState)&&digest(beforeLocal)===digest(afterLocal),'Snapshot inventory changed while reading');await recheck();
    retirements.sort((a,b)=>a.receiptDigest.localeCompare(b.receiptDigest));
    return {identity,snapshots,protectedSnapshot:currentMatches[0],availability,stateFiles,claims,
      proof:{identity,binding,deletionMode,currentDigest:digest(current),metadataDigest:digest(metadata),metadataFiles:metadata,localFiles,remoteObjects,retirements}};
  }
  return {
    capture,conditionalDeleteSupported,deletionMode,
    async assertFresh(proof){await recheck();need(proof.binding===binding,'Cleanup target changed');
      need(digest(json(resolve(config.stateDirectory,'local-snapshot.json')))===proof.currentDigest,'Current recovery snapshot changed');},
    async verifyLocal(snapshot,proof){const entry=proof.localFiles.find(file=>file.path===snapshot.localArchiveFile);need(entry,'Local snapshot missing');return verifySnapshotCiphertext(snapshot.localArchiveFile,snapshot,entry);},
    async verifyRemote(snapshot){return remoteCiphertext(client,config.bucket,snapshot);},
    async verifyRecovery(snapshot){return verifyRetainedRecovery({snapshot,localArchiveFile:snapshot.localArchiveFile,identity:{...identity}});},
    async planMetadata(captured,plan){
      return planCompletedSnapshotMetadata(captured,plan,config,{readJson:json});
    },
    async verifyMetadata(op,proof,requireRetired=false){
      need(op.files.length>=2&&op.files.every(file=>dirname(file.path)===config.stateDirectory),'Scoped completed snapshot metadata required');
      for(const file of op.files)await verifyPrivateContent(file.path,{archiveBytes:file.bytes,archiveSha256:file.sha256},file,false);
      if(requireRetired) {
        const record=json(op.retirementFile);
        const expected=proof.retirements.find(item=>item.receiptDigest===op.receiptDigest);
        need(expected&&digest(record)===digest({...expected,localDeleted:true,remoteDeleted:true}),
          'Both snapshot deletions must have durable known results');
        let localMissing=false,remoteMissing=false;
        try{await lstat(op.localArchiveFile);}catch(error){if(!absent(error))throw error;localMissing=true;}
        try{await send(new HeadObjectCommand({Bucket:config.bucket,Key:op.archiveKey}));}catch(error){if(!absent(error))throw error;remoteMissing=true;}
        need(localMissing&&remoteMissing,'Snapshot metadata still has a surviving archive');
      }
      await this.assertFresh(proof);
    },
    async lock(){await recheck();const path=resolve(config.stateDirectory,'snapshot-cleanup.lock');
      await writeNew(path,{version:1,pid:process.pid,binding});const owned=await privateEntry(path);
      return async()=>{const current=await privateEntry(path);need(sameFile(current,owned),'Cleanup lock ownership changed');await unlink(path);await syncDirectory(config.stateDirectory);};},
    async journal(preview){
      const existing=readCheckpoint();need(!existing||existing.pending===null,'Unresolved snapshot deletion requires inspection');
      const same=existing?.previewDigest===preview.previewDigest;
      if(same)need(existing.planDigest===preview.plan.planDigest,'Saved cleanup scope changed');
      let checkpoint={version:1,previewDigest:preview.previewDigest,planDigest:preview.plan.planDigest,pending:null,done:same?existing.done:[],
        completedSummary:existing?.completedSummary??{local:0,remote:0,metadata:0}};
      need(Array.isArray(checkpoint.done)&&checkpoint.done.length<=128,'Cleanup checkpoint bound exceeded');
      return {done:checkpoint.done,async savePlan(){await writeReplace(checkpointPath,checkpoint);},
        async intent(op){checkpoint={...checkpoint,pending:op};await writeReplace(checkpointPath,checkpoint);},
        async result(op){
          if(op.location!=='metadata') {
            const snapshot=preview.snapshots.find(item=>digest(item)===op.receiptDigest);need(snapshot,'Retirement receipt changed');
            let retired;try{retired=json(retirementPath(snapshot));}catch(error){if(!absent(error))throw error;retired=retirement(snapshot);}
            need(digest(retired)===digest(retirement(snapshot,retired.localDeleted,retired.remoteDeleted)),'Retirement result changed');
            await writeReplace(retirementPath(snapshot),{...retired,[`${op.location}Deleted`]:true});
          }
          checkpoint={...checkpoint,pending:null,done:[...checkpoint.done,operationId(op)],completedSummary:{...checkpoint.completedSummary,
            [op.location]:checkpoint.completedSummary[op.location]+1}};
          await writeReplace(checkpointPath,checkpoint);
        }};
    },
    async removeRemote(snapshot){
      need(deletionMode!=='unavailable','Provider conditional DELETE is unverified');
      await recheck();
      if(deletionMode==='immutable-source-namespace') {
        // Provider lacks atomic conditional DELETE. This explicit alternative is
        // safe only while the proven exclusive lifecycle owns an immutable
        // IfNoneMatch:* namespace; outside writers remain a documented limit.
        await remoteCiphertext(client,config.bucket,snapshot);await recheck();
      }
      await send(new DeleteObjectCommand({Bucket:config.bucket,Key:snapshot.archiveKey,...(deletionMode==='if-match'?{IfMatch:snapshot.objectEtag}:{})}));
      let missing=false;try{await send(new HeadObjectCommand({Bucket:config.bucket,Key:snapshot.archiveKey}));}catch(error){if(!absent(error))throw error;missing=true;}
      need(missing,'Remote DELETE result is unknown');
    },
    async removeLocal(snapshot,proof,nonce){
      const expected=proof.localFiles.find(file=>file.path===snapshot.localArchiveFile);need(expected,'Local snapshot is outside the reviewed inventory');
      return removeSnapshotCiphertext(snapshot,{archiveRoot:ROOT,expected,nonce,assertFresh:()=>this.assertFresh(proof)});
    },
    async removeMetadata(op,proof,nonce){
      await this.verifyMetadata(op,proof,true);
      const record=await privateEntry(op.retirementFile),data=read(op.retirementFile,128*1024);
      for(const file of [...op.files,{path:op.retirementFile,sha256:bytesDigest(data),...record}]) {
        await removeCheckedFile({localArchiveFile:file.path,archiveBytes:file.bytes,archiveSha256:file.sha256},
          {archiveRoot:config.stateDirectory,expected:file,nonce,assertFresh:()=>this.assertFresh(proof),ciphertext:false});
      }
    },
  };
}

function recoveryProof(value,snapshot,identity,now) {
  const checked=typeof value?.checkedAt==='string'?Date.parse(value.checkedAt):NaN;
  return value?.verified===true&&['archiveKey','archiveSha256'].every(key=>value[key]===snapshot[key])
    &&['sourceId','storageScopeId','archiveKeyId','databaseSystemIdentifier','generation'].every(key=>value[key]===identity[key])
    &&Number.isFinite(checked)&&new Date(checked).toISOString()===value.checkedAt&&checked<=now&&now-checked<120_000;
}
function previewPayload(captured,plan,metadataCandidates) {return {version:1,dryRun:true,plan,proof:captured.proof,snapshots:captured.snapshots,
  protectedSnapshot:captured.protectedSnapshot,availability:captured.availability,metadataCandidates};}
async function verifyOperation(adapter,op,proof,retired=false) {
  return op.location==='metadata'?adapter.verifyMetadata(op,proof,retired):adapter[op.location==='local'?'verifyLocal':'verifyRemote'](op,proof);
}
async function verifyProtected(adapter,captured,now) {
  await adapter.assertFresh(captured.proof);
  await adapter.verifyLocal(captured.protectedSnapshot,captured.proof);await adapter.verifyRemote(captured.protectedSnapshot);
  need(recoveryProof(await adapter.verifyRecovery(captured.protectedSnapshot),captured.protectedSnapshot,captured.identity,now()),'Retained recovery proof unavailable');
  await adapter.assertFresh(captured.proof);
}

export async function dryRunSnapshotCleanup(config,options={}) {
  const now=options.now??Date.now,adapter=options.adapter??await createSnapshotCleanupAdapter(config,options);
  const captured=await adapter.capture(),plan=planSnapshotRetention({...captured,planNonce:options.planNonce??randomUUID(),now:now()});
  need(plan.planningAllowed,`Snapshot retention planning refused: ${plan.reason??'unknown'}`);
  await verifyProtected(adapter,captured,now);
  for(const op of operations(plan)){await adapter.assertFresh(captured.proof);await adapter[op.location==='local'?'verifyLocal':'verifyRemote'](op,captured.proof);}
  const metadataCandidates=await adapter.planMetadata?.(captured,plan)??[];
  for(const op of metadataCandidates)await verifyOperation(adapter,op,captured.proof);
  const payload=previewPayload(captured,plan,metadataCandidates);
  return {...payload,previewDigest:digest(payload)};
}

/** Apply exactly a reviewed dry run. Completed, durably acknowledged operations
 * may resume within its fresh scope. An intent without a result is held forever
 * for explicit inspection; neither absence nor a new run authorizes a retry. */
export async function applySnapshotCleanup(config,preview,options={}) {
  const now=options.now??Date.now;
  need(preview?.version===1&&preview.dryRun===true,'Snapshot dry run required');
  const {previewDigest,...payload}=preview;need(previewDigest===digest(payload),'Snapshot dry run changed');
  const plannedAt=Date.parse(preview.plan?.binding?.plannedAt);
  need(Number.isFinite(plannedAt)&&plannedAt<=now()&&now()-plannedAt<MAX_AGE,'Snapshot dry run expired');
  const original=planSnapshotRetention({identity:preview.proof.identity,snapshots:preview.snapshots,protectedSnapshot:preview.protectedSnapshot,
    availability:preview.availability,planNonce:preview.plan.binding.planNonce,now:plannedAt});
  need(original.planningAllowed&&original.planDigest===preview.plan.planDigest,'Snapshot plan binding changed');
  const adapter=options.adapter??await createSnapshotCleanupAdapter(config,options),release=await adapter.lock();
  try {
    const journal=await adapter.journal(preview),done=new Set(journal.done),ops=operations(preview);
    need(journal.done.length===done.size&&[...done].every(id=>ops.some(op=>operationId(op)===id)),'Cleanup completion journal changed');
    if(ops.some(op=>op.location==='remote'&&!done.has(operationId(op))))need(adapter.conditionalDeleteSupported===true
      ||adapter.deletionMode==='immutable-source-namespace','Provider conditional DELETE is unverified');
    const captured=await adapter.capture(),expected=structuredClone(preview.proof);
    for(const op of ops.filter(op=>done.has(operationId(op)))) {
      if(op.location==='remote')expected.remoteObjects=expected.remoteObjects.filter(object=>object.key!==op.archiveKey);
      else if(op.location==='local')expected.localFiles=expected.localFiles.filter(file=>file.path!==op.localArchiveFile);
      if(expected.retirements) {
        if(op.location==='metadata')expected.retirements=expected.retirements.filter(item=>item.receiptDigest!==op.receiptDigest);
        else {const retired=expected.retirements.find(item=>item.receiptDigest===op.receiptDigest);if(retired)retired[`${op.location}Deleted`]=true;}
      }
      if(op.location==='metadata'&&expected.metadataFiles) {
        const names=new Set(op.files.map(file=>file.name));expected.metadataFiles=expected.metadataFiles.filter(file=>!names.has(file.name));
        expected.metadataDigest=digest(expected.metadataFiles);
      }
    }
    need(digest(captured.proof)===digest(expected),'Snapshot inventory changed since dry run');
    if(preview.metadataCandidates.length) {
      need(typeof adapter.planMetadata==='function','Completed metadata planner required');
      const currentMetadata=await adapter.planMetadata(captured,original);
      need(digest(currentMetadata)===digest(preview.metadataCandidates.filter(op=>!done.has(operationId(op)))),'Completed metadata scope changed');
    }
    await verifyProtected(adapter,captured,now);await journal.savePlan();
    let completed=0;const completedIds=new Set(done);
    const maxOperations=options.maxOperations??128;need(Number.isInteger(maxOperations)&&maxOperations>=1&&maxOperations<=128,'Cleanup operation bound required');
    for(const op of ops) {
      if(done.has(operationId(op)))continue;
      if(completedIds.size>=maxOperations)break;
      need(now()>=plannedAt&&now()-plannedAt<MAX_AGE,'Snapshot dry run expired');
      await adapter.assertFresh(captured.proof);await verifyOperation(adapter,op,captured.proof,op.location==='metadata');
      // The intent is fsynced before the first destructive request. Every failure
      // after this boundary is unknown, including failure to persist the result.
      await journal.intent(op);await adapter.assertFresh(captured.proof);
      await adapter[op.location==='metadata'?'removeMetadata':op.location==='local'?'removeLocal':'removeRemote'](op,captured.proof,preview.plan.binding.planNonce);
      await journal.result(op);completed++;completedIds.add(operationId(op));
    }
    return {version:1,applied:true,previewDigest,completed,resumed:done.size,remaining:ops.length-completedIds.size,
      localDeleted:ops.filter(op=>op.location==='local'&&completedIds.has(operationId(op))).length,
      remoteDeleted:ops.filter(op=>op.location==='remote'&&completedIds.has(operationId(op))).length,
      metadataDeleted:ops.filter(op=>op.location==='metadata'&&completedIds.has(operationId(op))).length};
  } finally {await release();}
}
