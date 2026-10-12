import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createHash} from 'node:crypto';import {Readable} from 'node:stream';
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
  return {root,config,receipt,archive,calls,client,uploaded:()=>uploaded,corrupt:()=>{corrupt=true;}};
}
test('dryRun verifies a sealed encrypted archive without a provider call or state publication',async t=>{
  const f=await fixture(t);assert.equal((await transferSnapshot(f.config,{client:f.client,now:()=>now})).executed,false);
  assert.equal(f.calls.length,0);assert.deepEqual(await readdir(f.config.stateDirectory),[]);
});
test('explicit transfer reads back exact ciphertext and emits a generation/root-bound receipt',async t=>{
  const f=await fixture(t);const result=await transferSnapshot(f.config,{client:f.client,now:()=>now,apply:true});assert.equal(result.verified,true);
  assert.deepEqual(f.uploaded(),f.archive);assert.equal(decryptBackup(f.uploaded(),'a'.repeat(64)).toString(),'synthetic DB/Auth/images/journal archive');
  const snapshot=JSON.parse(await readFile(result.receipt,'utf8'));assert.equal(snapshot.generation,generation);assert.equal(snapshot.imageRoot,f.config.imageRoot);
  assert.equal(snapshot.restoreVerifiedAt,'2026-10-12T01:59:59.987Z');assert(snapshot.archiveKey.endsWith('.local.tar.enc'));
  assert.deepEqual(f.calls,['ListObjectsV2Command','PutObjectCommand','HeadObjectCommand','GetObjectCommand']);
});
test('failed readback preserves unknown intent and never resends the same attempt',async t=>{
  const f=await fixture(t);f.corrupt();await assert.rejects(transferSnapshot(f.config,{client:f.client,now:()=>now,apply:true}));
  const names=await readdir(f.config.stateDirectory);assert.equal(names.length,1);assert(names[0].endsWith('.offsite-intent.json'));
  await assert.rejects(transferSnapshot(f.config,{client:f.client,now:()=>now,apply:true}));assert.equal(f.calls.filter(name=>name==='PutObjectCommand').length,1);
});
test('wrong source/root/key recovery or expired producer evidence is refused before any provider access',async t=>{
  const f=await fixture(t);
  for(const changes of [{sourceId:generation},{imageRoot:join(f.root,'wrong')},{independentRecoveryCopyChecked:false},{verifiedAt:'2026-10-11T00:00:00Z'},{archiveSha256:'f'.repeat(64)}]){
    await writeFile(f.config.producerReceiptFile,JSON.stringify({...f.receipt,...changes}),{mode:0o600});
    await assert.rejects(transferSnapshot(f.config,{client:f.client,now:()=>now,apply:true}));
  }
  assert.equal(f.calls.length,0);
});

test('capacity includes old image objects and refuses transfer before PUT or intent creation',async t=>{
  const f=await fixture(t);
  const client={async send(command){assert.equal(command.constructor.name,'ListObjectsV2Command');return {Contents:[{Key:'old-images/retained.webp',Size:f.config.maxStorageBytes}],IsTruncated:false};}};
  await assert.rejects(transferSnapshot(f.config,{client,now:()=>now,apply:true}));
  assert.deepEqual(await readdir(f.config.stateDirectory),[]);
});
