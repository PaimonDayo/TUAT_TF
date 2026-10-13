import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createHash} from 'node:crypto';import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {transferSnapshot} from './offsite.mjs';import {encryptBackup,decryptBackup} from '../laptop/backup-backend.mjs';

const sourceId='11111111-1111-4111-8111-111111111111',generation='22222222-2222-4222-8222-222222222222',now=Date.parse('2026-10-12T02:00:00.000Z');
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'tuat-offsite-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const stateDirectory=join(root,'state');await mkdir(stateDirectory,{mode:0o700});
  const archive=encryptBackup(Buffer.from('synthetic DB/Auth/images/journal archive'),'a'.repeat(64));
  const config={version:1,enabled:true,sourceId,generation,databaseSystemIdentifier:'1234567890123456789',imageRoot:join(root,'images'),
    archiveFile:join(root,'archive.enc'),producerReceiptFile:join(root,'producer.json'),stateDirectory,bucket:'synthetic-backup',maxArchiveBytes:1000,maxStorageBytes:10000};
  const receipt={version:1,sourceId,databaseSystemIdentifier:config.databaseSystemIdentifier,imageRoot:config.imageRoot,archiveSha256:createHash('sha256').update(archive).digest('hex'),
    verifiedAt:'2026-10-12T01:59:00.123456+00:00',restoreVerifiedAt:'2026-10-12T01:59:59.987654+00:00',independentRecoveryCopyChecked:true};
  await writeFile(config.archiveFile,archive,{mode:0o600});await writeFile(config.producerReceiptFile,JSON.stringify(receipt),{mode:0o600});
  const calls=[];let uploaded,metadata;let corrupt=false;
  const client={async send(command){const name=command.constructor.name,input=command.input;calls.push(name);
    assert.equal(input.Bucket,config.bucket);
    if(name==='ListObjectsV2Command')return {Contents:[],IsTruncated:false};
    assert(input.Key.startsWith(`ops/pc-backend/${sourceId}/backups/`));
    if(name==='PutObjectCommand'){assert.equal(input.IfNoneMatch,'*');const chunks=[];for await(const chunk of input.Body)chunks.push(chunk);uploaded=Buffer.concat(chunks);metadata=input.Metadata;return {};}
    if(name==='HeadObjectCommand')return {ContentLength:uploaded.length,ETag:'"synthetic"',Metadata:metadata};
    if(name==='GetObjectCommand'){const data=Buffer.from(uploaded);if(corrupt)data[data.length-1]^=1;return {ContentLength:data.length,ETag:'"synthetic"',Metadata:metadata,Body:Readable.from([data])};}
    throw Error('Unexpected transport');}};
  return {root,config,receipt,archive,calls,client,read:path=>readFileSync(path),uploaded:()=>uploaded,corrupt:()=>{corrupt=true;}};
}
test('dryRun verifies a sealed encrypted archive without a provider call or state publication',async t=>{
  const f=await fixture(t);assert.equal((await transferSnapshot(f.config,{client:f.client,read:f.read,now:()=>now})).executed,false);
  assert.equal(f.calls.length,0);assert.deepEqual(await readdir(f.config.stateDirectory),[]);
});
test('explicit transfer reads back exact ciphertext and emits a generation/root-bound receipt',async t=>{
  const f=await fixture(t);const result=await transferSnapshot(f.config,{client:f.client,read:f.read,now:()=>now,apply:true});assert.equal(result.verified,true);
  assert.deepEqual(f.uploaded(),f.archive);assert.equal(decryptBackup(f.uploaded(),'a'.repeat(64)).toString(),'synthetic DB/Auth/images/journal archive');
  const snapshot=JSON.parse(await readFile(result.receipt,'utf8'));assert.equal(snapshot.generation,generation);assert.equal(snapshot.imageRoot,f.config.imageRoot);
  assert.equal(snapshot.restoreVerifiedAt,'2026-10-12T01:59:59.987Z');assert(snapshot.archiveKey.endsWith('.local.tar.enc'));
  assert.equal(snapshot.capturedAt,'2026-10-12T01:59:00.123Z');
  assert.deepEqual(f.calls,['ListObjectsV2Command','PutObjectCommand','HeadObjectCommand','GetObjectCommand']);
});
test('failed readback preserves unknown intent and never resends the same attempt',async t=>{
  const f=await fixture(t);f.corrupt();await assert.rejects(transferSnapshot(f.config,{client:f.client,read:f.read,now:()=>now,apply:true}));
  const names=await readdir(f.config.stateDirectory);assert.equal(names.length,1);assert(names[0].endsWith('.offsite-intent.json'));
  await assert.rejects(transferSnapshot(f.config,{client:f.client,read:f.read,now:()=>now,apply:true}));assert.equal(f.calls.filter(name=>name==='PutObjectCommand').length,1);
});
test('wrong source/root/key recovery or expired producer evidence is refused before any provider access',async t=>{
  const f=await fixture(t);
  for(const changes of [{sourceId:generation},{imageRoot:join(f.root,'wrong')},{independentRecoveryCopyChecked:false},{verifiedAt:'2026-10-11T00:00:00Z'},{archiveSha256:'f'.repeat(64)}]){
    await writeFile(f.config.producerReceiptFile,JSON.stringify({...f.receipt,...changes}),{mode:0o600});
    await assert.rejects(transferSnapshot(f.config,{client:f.client,read:f.read,now:()=>now,apply:true}));
  }
  assert.equal(f.calls.length,0);
});

test('capacity includes old image objects and refuses transfer before PUT or intent creation',async t=>{
  const f=await fixture(t);
  const client={async send(command){assert.equal(command.constructor.name,'ListObjectsV2Command');return {Contents:[{Key:'old-images/retained.webp',Size:f.config.maxStorageBytes}],IsTruncated:false};}};
  await assert.rejects(transferSnapshot(f.config,{client,read:f.read,now:()=>now,apply:true}));
  assert.deepEqual(await readdir(f.config.stateDirectory),[]);
});

async function pcFixture(t) {
  const f=await fixture(t),hostState=join(f.root,'host-state');await mkdir(hostState,{mode:0o700});
  Object.assign(f.config,{profile:'pc-private',hostConfigFile:join(f.root,'host.json'),imageRoot:'/var/lib/tuat-local/images',generation:'manual-value-is-not-authority'});
  f.receipt.imageRoot=f.config.imageRoot;await writeFile(f.config.producerReceiptFile,JSON.stringify(f.receipt),{mode:0o600});
  const backup={version:1,enabled:true,profile:'pc-private',executionMode:'linux',dockerSocket:'unix:///run/tuat-local/docker.sock',instanceId:sourceId,
    localImageRoot:f.config.imageRoot,localSnapshotReceiptFile:join(f.config.stateDirectory,'local-snapshot.json'),stateDirectory:join(f.root,'backup-state'),
    target:{containerId:'a'.repeat(64),containerImageId:'sha256:'+'b'.repeat(64),containerName:'tuat-local-db',sourceLabel:sourceId,roleLabel:'db',
      configSha256:'c'.repeat(64),dataMountSource:'/var/lib/tuat-local/db',databaseName:'tuat_fixture',databaseSystemIdentifier:f.config.databaseSystemIdentifier}};
  const host={version:1,enabled:true,stateDirectory:hostState,backupConfigFile:join(f.root,'backup.json'),expectedBackupInstanceId:sourceId,
    expectedBackupDatabaseSystemIdentifier:f.config.databaseSystemIdentifier,expectedBackupDatabaseName:backup.target.databaseName,
    applicationUid:65530,applicationGid:65530,releaseCommit:'d'.repeat(40),releaseId:'synthetic-release'};
  const runtime={version:1,running:true,releaseCommit:host.releaseCommit,releaseId:host.releaseId,startedAt:'2026-10-12T01:58:30.000Z',checkedAt:new Date(now).toISOString(),
    backup:{identity:{instanceId:sourceId,generation,startedAt:'2026-10-12T01:58:30.000Z',databaseSystemIdentifier:f.config.databaseSystemIdentifier,databaseName:backup.target.databaseName},
      statusPath:join(backup.stateDirectory,'backup-lifecycle.json')}};
  const save=async()=>{for(const [path,value] of [[f.config.hostConfigFile,host],[host.backupConfigFile,backup],[join(hostState,'runtime-status.json'),runtime]])await writeFile(path,JSON.stringify(value),{mode:0o600});};
  await save();return {...f,host,backup,runtime,save,options:{client:f.client,read:f.read,assertRoot:()=>{},now:()=>now,apply:true}};
}

test('PC transfer derives active host generation and preserves fully ordered capture/restore/offsite times',async t=>{
  const f=await pcFixture(t),result=await transferSnapshot(f.config,f.options),snapshot=JSON.parse(await readFile(result.receipt,'utf8'));
  assert.equal(snapshot.generation,generation);assert.notEqual(snapshot.generation,f.config.generation);
  assert.equal(snapshot.capturedAt,new Date(Date.parse(f.receipt.verifiedAt)).toISOString());
  assert(Date.parse(f.runtime.startedAt)<=Date.parse(snapshot.capturedAt)&&Date.parse(snapshot.capturedAt)<=Date.parse(snapshot.restoreVerifiedAt)&&Date.parse(snapshot.restoreVerifiedAt)<=Date.parse(snapshot.offsiteVerifiedAt));
});

test('fresh host cannot relabel an old capture even with a new restore and offsite clock',async t=>{
  const f=await pcFixture(t);f.runtime.startedAt=f.runtime.backup.identity.startedAt='2026-10-12T01:59:30.000Z';await f.save();
  await assert.rejects(transferSnapshot(f.config,f.options));assert.equal(f.calls.length,0);assert.deepEqual(await readdir(f.config.stateDirectory),[]);
});

test('PC host root authority, fresh running record, target, release and receipt path must all match before provider access',async t=>{
  const f=await pcFixture(t);
  await assert.rejects(transferSnapshot(f.config,{...f.options,assertRoot:()=>{throw Error('Synthetic nonroot');}}));
  for(const change of [()=>{f.runtime.running=false;},()=>{f.runtime.checkedAt='2026-10-12T02:00:00.001Z';},
    ()=>{f.runtime.startedAt=f.runtime.backup.identity.startedAt='2026-10-12T01:56:00.000Z';f.runtime.checkedAt='2026-10-12T01:58:00.000Z';},
    ()=>{f.runtime.releaseId='different';},()=>{f.backup.target.roleLabel='auth';},()=>{f.host.expectedBackupDatabaseName='different';},
    ()=>{f.backup.localSnapshotReceiptFile=join(f.root,'other.json');},()=>{f.backup.localImageRoot='/var/lib/tuat-local/other';}]) {
    const prior=structuredClone({host:f.host,backup:f.backup,runtime:f.runtime});change();await f.save();
    await assert.rejects(transferSnapshot(f.config,f.options));Object.assign(f.host,prior.host);Object.assign(f.backup,prior.backup);Object.assign(f.runtime,prior.runtime);
  }
  assert.equal(f.calls.length,0);
});

test('generation changes before PUT refuse dispatch and preserve an unknown intent',async t=>{
  const f=await pcFixture(t),send=f.client.send;
  f.client.send=async command=>{const result=await send(command);if(command.constructor.name==='ListObjectsV2Command'){f.runtime.backup.identity.generation='33333333-3333-4333-8333-333333333333';await f.save();}return result;};
  await assert.rejects(transferSnapshot(f.config,f.options));assert.equal(f.calls.filter(name=>name==='PutObjectCommand').length,0);
  assert((await readdir(f.config.stateDirectory)).some(name=>name.endsWith('.offsite-intent.json')));
});

test('generation changes after upload hold prior publication and never replay unknown PUT',async t=>{
  const f=await pcFixture(t),send=f.client.send,target=join(f.config.stateDirectory,'local-snapshot.json');await writeFile(target,'prior receipt',{mode:0o600});
  f.client.send=async command=>{const result=await send(command);if(command.constructor.name==='GetObjectCommand'){f.runtime.backup.identity.generation='33333333-3333-4333-8333-333333333333';await f.save();}return result;};
  await assert.rejects(transferSnapshot(f.config,f.options));assert.equal(await readFile(target,'utf8'),'prior receipt');
  await assert.rejects(transferSnapshot(f.config,f.options));assert.equal(f.calls.filter(name=>name==='PutObjectCommand').length,1);
  assert((await readdir(f.config.stateDirectory)).some(name=>name.endsWith('.offsite-intent.json')));
});
