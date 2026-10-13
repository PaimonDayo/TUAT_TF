import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { boundedReadback,createAdapters,createCycleBudget,inventoryBounds,STORAGE_LIMITS,BACKUP_LIMITS } from './adapters.mjs';
import { sha256,encryptedPair } from './archive.mjs';
import { backupTargetFingerprint } from './config.mjs';
test('readback accepts only exactly bounded bytes',async()=>{
  const bytes=Buffer.alloc(40,1);assert.deepEqual(await boundedReadback(Readable.from([bytes]),{expectedBytes:40}),bytes);
  for(const size of [39,41]) await assert.rejects(boundedReadback(Readable.from([Buffer.alloc(size)]),{expectedBytes:40}));
});
test('stream deadline destroys a real never-ending body and returns within bound',async()=>{
  const body=new Readable({read(){}});
  await assert.rejects(boundedReadback(body,{expectedBytes:40,timeoutMilliseconds:5}));
  assert.equal(body.destroyed,true);
});
test('stop signal destroys a body stalled after headers',async()=>{
  const controller=new AbortController(),body=new Readable({read(){}});
  const waiting=boundedReadback(body,{expectedBytes:40,signal:controller.signal});controller.abort();
  await assert.rejects(waiting);assert.equal(body.destroyed,true);
});
test('bounded reader invokes cancel as well as destroy when an adapter exposes both',async()=>{
  let destroyed=0,cancelled=0;
  const body={destroy(){destroyed++;},cancel(){cancelled++;},async *[Symbol.asyncIterator](){await new Promise(()=>{});}};
  await assert.rejects(boundedReadback(body,{expectedBytes:40,timeoutMilliseconds:1}));
  assert.ok(destroyed>0);assert.ok(cancelled>0);
});
function adapterFixture() {
  const binary=Buffer.from('synthetic executable pin'),calls=[];
  const target={containerId:'a'.repeat(64),containerImageId:`sha256:${'b'.repeat(64)}`,containerName:'synthetic-db',composeProject:'synthetic-owned',composeService:'db',
    dataMountSource:'/synthetic/owned',databaseSystemIdentifier:'1234567890123456789',databaseName:'postgres'};
  const config={wslExecutable:'C:\\synthetic\\wsl.exe',wslSha256:sha256(binary),wslDistribution:'synthetic',wslUser:'synthetic',dockerExecutable:'/usr/bin/docker',dockerSha256:'c'.repeat(64),
    psqlExecutable:'/usr/bin/psql',pgDumpExecutable:'/usr/bin/pg_dump',instanceId:'11111111-1111-4111-8111-111111111111',target};
  let wrongTarget=false,failCommand=false;
  const dependencies={readBinary:()=>binary,async execute(executable,args,options) {
    calls.push({executable,args,options});if(failCommand) throw Error('synthetic WSL timeout');
    const text=args.includes('/usr/bin/sha256sum')?`${config.dockerSha256}  /usr/bin/docker`:args.includes('inspect')?
      [target.containerId,target.containerImageId,`/${target.containerName}`,'true',target.composeProject,'db',wrongTarget?'/different/mount':target.dataMountSource].join('|'):
      `postgres|${target.databaseSystemIdentifier}`;
    return {stdout:Buffer.from(text)};
  }};
  return {config,calls,dependencies,wrong:()=>{wrongTarget=true;},fail:()=>{failCommand=true;}};
}

function nativeAdapterFixture() {
  const f=adapterFixture();
  for(const key of ['wslExecutable','wslSha256','wslDistribution','wslUser'])delete f.config[key];
  f.config.executionMode='linux';f.config.dockerSha256=sha256(f.dependencies.readBinary());
  Object.assign(f.config.target,{ownerLabel:'synthetic-runtime',generationLabel:'1'.repeat(32),databaseName:'tuat_pc_candidate'});
  let wrongOwner=false,failed=false;
  f.dependencies.execute=async(executable,args,options)=>{
    f.calls.push({executable,args,options});if(failed)throw Error('Synthetic native timeout');
    const t=f.config.target;
    return {stdout:Buffer.from(args.includes('inspect')?[t.containerId,t.containerImageId,'/'+t.containerName,'true',wrongOwner?'different-owner':t.ownerLabel,t.generationLabel,t.dataMountSource].join('|'):
      t.databaseName+'|'+t.databaseSystemIdentifier)};
  };
  return {...f,wrong:()=>{wrongOwner=true;},fail:()=>{failed=true;}};
}

function pcAdapterFixture() {
  const f=nativeAdapterFixture();
  Object.assign(f.config,{profile:'pc-private',enabled:true,dockerSocket:'unix:///run/tuat-local/docker.sock',
    localSnapshotReceiptFile:'/private/offsite/local-snapshot.json',localImageRoot:'/var/lib/tuat-local/images'});
  // Keep Windows pure fixtures canonical on the current test platform.
  f.config.localSnapshotReceiptFile=resolve(f.config.localSnapshotReceiptFile);
  for(const key of ['ownerLabel','generationLabel','composeProject','composeService'])delete f.config.target[key];
  Object.assign(f.config.target,{containerName:'tuat-local-db',dataMountSource:'/var/lib/tuat-local/db',sourceLabel:f.config.instanceId,roleLabel:'db',configSha256:'e'.repeat(64)});
  f.dependencies.execute=async(executable,args,options)=>{
    f.calls.push({executable,args,options});const t=f.config.target,statement=args.at(-1);
    return {stdout:Buffer.from(args.includes('inspect')?[t.containerId,t.containerImageId,'/'+t.containerName,'true',t.sourceLabel,t.roleLabel,t.configSha256,t.dataMountSource].join('|'):
      args.includes(f.config.pgDumpExecutable)?'PGDMPsynthetic':statement.includes('vault.decrypted_secrets')?'[]':
        statement.includes("to_regclass('cron.job')")?'f':t.databaseName+'|'+t.databaseSystemIdentifier)};
  };
  return f;
}

test('actual PC label-shaped metadata uses one private socket and explicit postgres /tmp:18304',async()=>{
  const f=pcAdapterFixture(),adapter=createAdapters(f.config,{},f.dependencies);
  assert.deepEqual(await adapter.probe({signal:signal()}),f.config.target);
  assert.equal(String(await adapter.dump({signal:signal()})),'PGDMPsynthetic');f.config.pushEnvironmentFile=null;
  const recovery=await adapter.recovery({signal:signal()});assert.deepEqual(recovery.vault,[]);assert.equal(recovery.cron.installed,false);
  assert.equal(f.calls.length,5);
  for(const call of f.calls){
    assert.deepEqual(call.args.slice(0,2),['--host','unix:///run/tuat-local/docker.sock']);
    if(call.args.includes('inspect')){
      const format=call.args[call.args.indexOf('--format')+1];assert(format.includes('tuat.local.source'));assert(format.includes('tuat.local.role'));assert(format.includes('tuat.local.config-sha256'));
      assert(!format.includes('tuat.owner'));assert(!format.includes('tuat.generation'));
    }else{
      assert(call.args.includes('--host=/tmp'));assert(call.args.includes('--port=18304'));
      assert.equal(call.args[call.args.indexOf('-U')+1],'postgres');assert.equal(call.args[call.args.indexOf('-d')+1],f.config.target.databaseName);
    }
  }
});

test('PC wrong source/hash/name/database metadata and disabled execution remain closed',async()=>{
  for(const kind of ['source','hash','name','database','system','disabled']){
    const f=pcAdapterFixture(),execute=f.dependencies.execute;
    if(kind==='disabled')f.config.enabled=false;
    f.dependencies.execute=async(executable,args,options)=>{
      const result=await execute(executable,args,options),fields=String(result.stdout).split('|');
      if(args.includes('inspect')){const index={source:4,hash:6,name:2}[kind];if(index!==undefined)fields[index]=kind==='hash'?'f'.repeat(64):kind==='source'?'33333333-3333-4333-8333-333333333333':'/another-db';}
      else if(kind==='database')fields[0]='postgres';else if(kind==='system')fields[1]='9876543210987654321';
      return {stdout:Buffer.from(fields.join('|'))};
    };
    await assert.rejects(createAdapters(f.config,{},f.dependencies).probe({signal:signal()}));
    assert.equal(f.calls.length,kind==='disabled'?0:['database','system'].includes(kind)?2:1);
  }
  for(const change of [{dockerSocket:'unix:///var/run/docker.sock'},{localSnapshotReceiptFile:undefined},{target:'fake'}]){
    const f=pcAdapterFixture();Object.assign(f.config,change);assert.throws(()=>createAdapters(f.config,{},f.dependencies));assert.equal(f.calls.length,0);
  }
  const disabled=pcAdapterFixture();disabled.config.enabled=false;const adapter=createAdapters(disabled.config,{},disabled.dependencies);
  for(const operation of ['dump','recovery'])await assert.rejects(adapter[operation]({signal:signal()}));assert.equal(disabled.calls.length,0);
});

test('PC scope cannot reuse a legacy receipt by inventing the old ownership labels',async()=>{
  const old=remoteFixture(),pc=pcAdapterFixture();let remoteCalls=0;
  const adapter=createAdapters(pc.config,old.env,{...pc.dependencies,createStorage:()=>({send(){remoteCalls++;throw Error('Must not dispatch');}})});
  await assert.rejects(adapter.verifyInventory({snapshot:old.snapshot(),receipts:old.receipts,budget:budget(),signal:signal()}));
  assert.equal(remoteCalls,0);assert.equal(pc.calls.length,0);assert.notEqual(backupTargetFingerprint(pc.config),old.receipts[0].targetFingerprint);
  pc.config.profile=undefined;pc.config.target.ownerLabel='fake-owner';pc.config.target.generationLabel='fake-generation';
  assert.throws(()=>createAdapters(pc.config,old.env,pc.dependencies));assert.equal(pc.calls.length,0);
});

test('native Linux probe verifies its owned DB without WSL or ambient Docker context',async()=>{
  const f=nativeAdapterFixture(),adapter=createAdapters(f.config,{},f.dependencies);
  assert.deepEqual(await adapter.probe({signal:new AbortController().signal}),f.config.target);
  assert.equal(f.calls.length,2);
  for(const call of f.calls){
    assert.equal(call.executable,'/usr/bin/docker');assert.deepEqual(call.args.slice(0,2),['--host','unix:///var/run/docker.sock']);
    assert(!call.args.includes('--exec'));assert.deepEqual(call.options.env,{LANG:'C.UTF-8',DOCKER_CONFIG:'/nonexistent'});
  }
  assert(f.calls[1].args.includes('tuat_pc_candidate'));
  f.wrong();await assert.rejects(adapter.probe({signal:new AbortController().signal}),/ownership mismatch/);
});

test('private daemon pins every inspect, probe, dump and recovery command to the selected socket',async()=>{
  const f=nativeAdapterFixture(),socket='unix:///run/tuat-local/docker.sock';f.config.dockerSocket=socket;f.config.pushEnvironmentFile=null;
  f.dependencies.execute=async(executable,args,options)=>{
    f.calls.push({executable,args,options});const t=f.config.target,statement=args.at(-1);
    const stdout=args.includes('inspect')?[t.containerId,t.containerImageId,'/'+t.containerName,'true',t.ownerLabel,t.generationLabel,t.dataMountSource].join('|'):
      args.includes(f.config.pgDumpExecutable)?'PGDMPsynthetic':statement.includes('vault.decrypted_secrets')?'[]':
        statement.includes("to_regclass('cron.job')")?'t':statement.includes('FROM cron.job')?'[]':t.databaseName+'|'+t.databaseSystemIdentifier;
    return {stdout:Buffer.from(stdout)};
  };
  const adapter=createAdapters(f.config,{},f.dependencies);
  f.config.dockerSocket='tcp://remote.example.test:2375'; // A later mutation must not change this adapter's selected transport.
  assert.deepEqual(await adapter.probe({signal:signal()}),f.config.target);
  assert.equal(String(await adapter.dump({signal:signal()})),'PGDMPsynthetic');
  const {capturedAt,...recovery}=await adapter.recovery({signal:signal()});
  assert.equal(new Date(capturedAt).toISOString(),capturedAt);
  assert.deepEqual(recovery,{version:1,vault:[],pushEnv:null,cron:{installed:true,jobs:[]}});
  assert.equal(f.calls.length,6);
  for(const call of f.calls){
    assert.equal(call.executable,f.config.dockerExecutable);assert.deepEqual(call.args.slice(0,2),['--host',socket]);
    assert.deepEqual(call.options.env,{LANG:'C.UTF-8',DOCKER_CONFIG:'/nonexistent'});
    assert(call.args.includes(f.config.target.containerId));assert(!call.args.includes('--context'));
    if(call.args.includes('exec'))assert.equal(call.args[call.args.indexOf('-d')+1],f.config.target.databaseName);
  }
});

test('invalid socket or explicit WSL socket dispatches nothing; default transport remains supported',()=>{
  for(const mode of ['native','wsl'])for(const dockerSocket of ['tcp://127.0.0.1:2375','unix:///other/docker.sock',
    ...(mode==='wsl'?['unix:///run/tuat-local/docker.sock','unix:///var/run/docker.sock']:[])]){
    const f=mode==='native'?nativeAdapterFixture():adapterFixture();f.config.dockerSocket=dockerSocket;
    assert.throws(()=>createAdapters(f.config,{},f.dependencies));assert.equal(f.calls.length,0);
  }
});

test('private socket retains command uncertainty poisoning across all later database operations',async()=>{
  const f=nativeAdapterFixture();f.config.dockerSocket='unix:///run/tuat-local/docker.sock';
  const adapter=createAdapters(f.config,{},f.dependencies);f.fail();
  await assert.rejects(adapter.probe({signal:signal()}),/outcome unverified/);assert.equal(f.calls.length,1);
  for(const method of ['probe','dump','recovery'])await assert.rejects(adapter[method]({signal:signal()}),/reconciliation/);
  assert.equal(f.calls.length,1);assert.equal(adapter.isDrained(),false);
  assert.deepEqual(f.calls[0].args.slice(0,2),['--host','unix:///run/tuat-local/docker.sock']);
});

test('private daemon still rejects every wrong container field and database identity',async()=>{
  for(const changed of ['id','image','name','running','owner','generation','mount','database','system']){
    const f=nativeAdapterFixture();f.config.dockerSocket='unix:///run/tuat-local/docker.sock';
    const execute=f.dependencies.execute;
    f.dependencies.execute=async(executable,args,options)=>{
      const result=await execute(executable,args,options),fields=String(result.stdout).split('|');
      if(args.includes('inspect')){
        const index=['id','image','name','running','owner','generation','mount'].indexOf(changed);
        if(index>=0)fields[index]='different';
      }else if(changed==='database')fields[0]='postgres';else if(changed==='system')fields[1]='9876543210987654321';
      return {stdout:Buffer.from(fields.join('|'))};
    };
    await assert.rejects(createAdapters(f.config,{},f.dependencies).probe({signal:signal()}),/ownership mismatch|system identity mismatch/);
    assert.equal(f.calls.length,['database','system'].includes(changed)?2:1);
    assert(f.calls.every(call=>call.args[1]==='unix:///run/tuat-local/docker.sock'));
  }
});

test('native pin change and unknown command outcome prevent later dispatch',async()=>{
  const changed=nativeAdapterFixture();changed.dependencies.readBinary=()=>Buffer.from('changed native binary');
  await assert.rejects(createAdapters(changed.config,{},changed.dependencies).probe({signal:new AbortController().signal}),/pin changed/);
  assert.equal(changed.calls.length,0);
  const unknown=nativeAdapterFixture(),adapter=createAdapters(unknown.config,{},unknown.dependencies);unknown.fail();
  await assert.rejects(adapter.probe({signal:new AbortController().signal}),/outcome unverified/);
  const count=unknown.calls.length;
  await assert.rejects(adapter.probe({signal:new AbortController().signal}),/reconciliation/);
  assert.equal(unknown.calls.length,count);
});
test('actual probe adapter uses pinned explicit WSL exec/local Docker socket, no ambient credentials/context or rows',async()=>{
  const f=adapterFixture(),adapter=createAdapters(f.config,{},f.dependencies);const actual=await adapter.probe({signal:new AbortController().signal});
  assert.deepEqual(actual,f.config.target);assert.equal(f.calls.length,3);
  for(const call of f.calls) {
    assert.equal(call.executable,f.config.wslExecutable);assert.ok(call.args.includes('--exec'));assert.equal(call.options.windowsHide,true);
    for(const key of Object.keys(call.options.env)) assert.ok(['SystemRoot','WINDIR','SystemDrive','USERPROFILE','LOCALAPPDATA','APPDATA','TEMP','TMP','PROGRAMDATA'].includes(key));
    if(call.args[call.args.indexOf('--exec')+1]===f.config.dockerExecutable) assert.ok(call.args.includes('unix:///var/run/docker.sock'));
  }
  assert.ok(f.calls.at(-1).args.includes("SELECT current_database() || '|' || system_identifier::text FROM pg_control_system();"));
  f.wrong();await assert.rejects(adapter.probe({signal:new AbortController().signal}));
});
test('uncertain actual command prevents retries and reports undrained owner',async()=>{
  const f=adapterFixture(),adapter=createAdapters(f.config,{},f.dependencies);f.fail();await assert.rejects(adapter.probe({signal:new AbortController().signal}));
  const count=f.calls.length;await assert.rejects(adapter.probe({signal:new AbortController().signal}));assert.equal(f.calls.length,count);assert.equal(adapter.isDrained(),false);
});
test('actual upload adapter verifies both encrypted remote readbacks and never retries uncertain PUT',async()=>{
  const f=adapterFixture(),key='d'.repeat(64),pair=encryptedPair({dump:Buffer.from('PGDMPsynthetic'),recovery:{version:1,vault:[],cron:{installed:false,jobs:[]},pushEnv:null},
    instanceId:f.config.instanceId,key,stamp:'2026-10-11T00-30-00-000Z'});
  const objects=new Map(),calls=[];
  const client={async send(command) {
    const input=command.input;calls.push(command.constructor.name);
    if(command.constructor.name==='PutObjectCommand') {assert.equal(input.IfNoneMatch,'*');objects.set(input.Key,{bytes:input.Body,metadata:input.Metadata});return {};}
    const object=objects.get(input.Key);if(command.constructor.name==='GetObjectCommand')assert.equal(input.IfMatch,'"'+object.metadata.sha256+'"');
    return {ContentLength:object.bytes.length,Metadata:object.metadata,ETag:'"'+object.metadata.sha256+'"',...(command.constructor.name==='GetObjectCommand'?{Body:Readable.from([object.bytes])}:{})};
  },destroy(){}};
  const adapter=createAdapters(f.config,{PC_BACKUP_ENCRYPTION_KEY:key,R2_ACCOUNT_ID:'e'.repeat(32),R2_ACCESS_KEY_ID:'synthetic',R2_SECRET_ACCESS_KEY:'synthetic',R2_BUCKET_NAME:'synthetic'},
    {...f.dependencies,createStorage:()=>client});
  assert.deepEqual(await adapter.uploadAndVerify(pair,{signal:new AbortController().signal}),{verified:true,dumpEtag:'"'+pair.sha256+'"',recoveryEtag:'"'+pair.recoverySha256+'"'});
  assert.deepEqual(calls,['PutObjectCommand','HeadObjectCommand','GetObjectCommand','PutObjectCommand','HeadObjectCommand','GetObjectCommand']);
  client.send=async()=>{calls.push('uncertain');throw Error('synthetic unknown PUT');};
  await assert.rejects(adapter.uploadAndVerify(pair,{signal:new AbortController().signal}));assert.equal(calls.filter(value=>value==='uncertain').length,1);
});

const signal=()=>new AbortController().signal;
const budget=()=>createCycleBudget({maxRequestCount:100,maxTransferBytes:256*1024*1024});
function remoteFixture(count=1) {
  const f=adapterFixture(),key='d'.repeat(64),env={PC_BACKUP_ENCRYPTION_KEY:key,R2_ACCOUNT_ID:'e'.repeat(32),R2_ACCESS_KEY_ID:'synthetic',R2_SECRET_ACCESS_KEY:'synthetic',R2_BUCKET_NAME:'synthetic'};
  const objects=new Map(),receipts=[],pairs=[],calls=[];
  f.config.capacity={inventoryLimit:20,maxPairBytes:1024*1024};
  const scope={
    targetFingerprint:sha256(JSON.stringify(['containerId','containerImageId','containerName','composeProject','composeService','dataMountSource','databaseName','databaseSystemIdentifier'].map(name=>[name,f.config.target[name]]))),
    storageScopeId:sha256(JSON.stringify({account:env.R2_ACCOUNT_ID,bucket:env.R2_BUCKET_NAME})),archiveKeyId:sha256(Buffer.from(key,'hex'))
  };
  for(let index=0;index<count;index++) {
    const capturedAt=`2026-10-11T00:${String(index+1).padStart(2,'0')}:00.000Z`;
    const pair=encryptedPair({dump:Buffer.from('PGDMPsynthetic'),recovery:{version:1,vault:[],cron:{installed:false,jobs:[]},pushEnv:null},
      instanceId:f.config.instanceId,key,stamp:capturedAt.replace(/[:.]/g,'-')});
    pairs.push(pair);
    const dumpEtag='"'+pair.sha256+'"',recoveryEtag='"'+pair.recoverySha256+'"',pairBytes=pair.bytes.length+pair.recoveryBytes.length;
    receipts.push({version:1,state:'verified',remoteState:'verified',localState:'complete',receiptId:`22222222-2222-4222-8222-${String(index+1).padStart(12,'0')}`,
      instanceId:f.config.instanceId,generation:'33333333-3333-4333-8333-333333333333',startedAt:'2026-10-11T00:00:00.000Z',
      databaseSystemIdentifier:f.config.target.databaseSystemIdentifier,...scope,capturedAt,verifiedAt:capturedAt,
      dumpKey:pair.key,recoveryKey:pair.recoveryKey,dumpSha256:pair.sha256,recoverySha256:pair.recoverySha256,
      dumpEtag,recoveryEtag,dumpBytes:pair.bytes.length,recoveryBytes:pair.recoveryBytes.length,localBytes:pairBytes,remoteBytes:pairBytes});
    objects.set(pair.key,{bytes:pair.bytes,metadata:{sha256:pair.sha256,recovery:pair.recoveryKey},etag:dumpEtag});
    objects.set(pair.recoveryKey,{bytes:pair.recoveryBytes,metadata:{sha256:pair.recoverySha256},etag:recoveryEtag});
  }
  const prefix=`ops/pc-backend/${f.config.instanceId}/backups/`;
  const snapshot=()=>({complete:true,objects:[...objects].map(([key,item])=>({key,bytes:item.bytes.length,etag:item.etag})).sort((a,b)=>Buffer.compare(Buffer.from(a.key),Buffer.from(b.key)))});
  const client={async send(command,options) {
    calls.push({name:command.constructor.name,input:command.input,options});const input=command.input;
    if(command.constructor.name==='ListObjectsV2Command')return {IsTruncated:false,KeyCount:objects.size,Prefix:prefix,Contents:snapshot().objects.map(item=>({Key:item.key,Size:item.bytes,ETag:item.etag}))};
    if(command.constructor.name==='PutObjectCommand') {objects.set(input.Key,{bytes:input.Body,metadata:input.Metadata,etag:'"'+input.Metadata.sha256+'"'});return {};}
    const object=objects.get(input.Key);if(!object)throw Error('synthetic missing object; private credential marker');
    if(command.constructor.name==='GetObjectCommand')assert.equal(input.IfMatch,object.etag);
    return {ContentLength:object.bytes.length,Metadata:object.metadata,ETag:object.etag,...(command.constructor.name==='GetObjectCommand'?{Body:Readable.from([object.bytes])}:{})};
  },destroy(){}};
  const adapter=createAdapters(f.config,env,{...f.dependencies,createStorage:()=>client});
  return {...f,env,adapter,client,objects,receipts,pairs,calls,prefix,snapshot};
}

test('cycle reservations are atomic, consumed after failures, and bounded under overflow',()=>{
  const b=createCycleBudget({maxRequestCount:2,maxTransferBytes:40});b.reserve(1,20);
  for(const [requests,transfer] of [[2,1],[1,21],[-1,0],[0,Number.MAX_SAFE_INTEGER]]) {
    assert.throws(()=>b.reserve(requests,transfer));assert.deepEqual(b.snapshot(),{requestCount:1,transferBytes:20});
  }
  b.reserve(1,20);assert.deepEqual(b.snapshot(),{requestCount:2,transferBytes:40});assert.throws(()=>b.reserve(1,0));
  assert.throws(()=>createCycleBudget({maxRequestCount:0,maxTransferBytes:10}));
  assert.throws(()=>inventoryBounds({inventoryLimit:1,receipts:[],maxPairBytes:Number.MAX_SAFE_INTEGER}));
});

test('complete exact-prefix paginated inventory reserves each page before its single dispatch',async()=>{
  const f=remoteFixture(),items=f.snapshot().objects,b=budget();let page=0;
  f.client.send=async(command)=>{
    assert.equal(command.constructor.name,'ListObjectsV2Command');assert.equal(command.input.Prefix,f.prefix);assert.ok(command.input.MaxKeys<=1000);
    page++;assert.deepEqual(b.snapshot(),{requestCount:page,transferBytes:page*STORAGE_LIMITS.listPageBytes});
    assert.equal(command.input.ContinuationToken,page===1?undefined:'synthetic-page');
    return {IsTruncated:page===1,Contents:[{Key:items[page-1].key,Size:items[page-1].bytes,ETag:items[page-1].etag}],...(page===1?{NextContinuationToken:'synthetic-page'}:{})};
  };
  assert.deepEqual(await f.adapter.listInventory({prefix:f.prefix,inventoryLimit:2,budget:b,signal:signal()}),f.snapshot());assert.equal(page,2);
  await assert.rejects(f.adapter.listInventory({prefix:f.prefix+'wrong/',inventoryLimit:2,budget:b,signal:signal()}));assert.equal(page,2);
});

test('incomplete, ambiguous, or out-of-scope pages never become empty or complete inventory',async()=>{
  const modes=['outside','duplicate','overflow','truncated-empty','missing-token','repeated-token','too-many-pages','invalid-etag','key-count','partial-read'];
  for(const mode of modes) {
    const f=remoteFixture(),items=f.snapshot().objects;let dispatches=0;
    f.client.send=async()=>{
      dispatches++;if(mode==='partial-read')throw Error('private credential marker');
      const first=items[0],second=items[1];
      const item=mode==='duplicate'?first:dispatches===1?first:second;
      return {IsTruncated:['duplicate','repeated-token','too-many-pages','missing-token','truncated-empty'].includes(mode),
        Contents:mode==='truncated-empty'?[]:mode==='overflow'?items.map(item=>({Key:item.key,Size:item.bytes,ETag:item.etag})):
          [{Key:mode==='outside'?'ops/other-instance/object':mode==='too-many-pages'?`${f.prefix}object-${dispatches}`:item.key,Size:item.bytes,ETag:mode==='invalid-etag'?'bad\n':item.etag}],
        ...(mode==='key-count'?{KeyCount:99}:{}),
        ...(['duplicate','repeated-token','too-many-pages','truncated-empty'].includes(mode)?{NextContinuationToken:mode==='too-many-pages'?`page-${dispatches}`:'same-page'}:{})};
    };
    await assert.rejects(f.adapter.listInventory({prefix:f.prefix,inventoryLimit:mode==='overflow'?1:3,budget:budget(),signal:signal()}),error=>!error.message.includes('private credential'));
    assert.ok(dispatches<=2,mode);
  }
});

test('listing budget exhaustion and metadata bounds prevent further provider dispatch',async()=>{
  const f=remoteFixture();await assert.rejects(f.adapter.listInventory({prefix:f.prefix,inventoryLimit:2,budget:createCycleBudget({maxRequestCount:1,maxTransferBytes:STORAGE_LIMITS.listPageBytes-1}),signal:signal()}));
  assert.equal(f.calls.length,0);
  for(const item of [{key:f.prefix+'x'.repeat(1024),bytes:1,etag:'"valid"'},{key:f.prefix+'x',bytes:Number.MAX_SAFE_INTEGER+1,etag:'"valid"'}]) {
    f.client.send=async()=>({IsTruncated:false,Contents:[{Key:item.key,Size:item.bytes,ETag:item.etag}]});
    await assert.rejects(f.adapter.listInventory({prefix:f.prefix,inventoryLimit:2,budget:budget(),signal:signal()}));
  }
});

test('all same-scope receipts use HEAD plus conditional sequential GET and full upfront allowance',async()=>{
  const f=remoteFixture(2),b=budget(),pairBytes=f.receipts.reduce((total,item)=>total+item.remoteBytes,0),send=f.client.send;
  let activeGet=0;
  f.client.send=async(command,options)=>{
    assert.deepEqual(b.snapshot(),{requestCount:8,transferBytes:pairBytes+8*STORAGE_LIMITS.controlResponseBytes});
    const result=await send(command,options);
    if(command.constructor.name==='GetObjectCommand') {
      assert.equal(activeGet,0);activeGet++;
      const object=f.objects.get(command.input.Key);
      result.Body=Readable.from((async function*(){await Promise.resolve();yield object.bytes;activeGet--;})());
    }
    return result;
  };
  const result=await f.adapter.verifyInventory({snapshot:f.snapshot(),receipts:f.receipts,budget:b,signal:signal()});
  assert.deepEqual(result.verifiedReceiptIds,f.receipts.map(item=>item.receiptId));assert.equal(activeGet,0);assert.equal(f.calls.length,8);
  assert.equal(f.calls.filter(call=>call.name==='GetObjectCommand').length,4);
  assert.ok(f.calls.every(call=>!['PutObjectCommand','DeleteObjectCommand'].includes(call.name)));
});

test('receipt mismatch, missing object, held state, accessors, and full-set budget fail before first HEAD or GET',async()=>{
  const modes=['instance','system','target','storage','archive','incomplete','outside','missing','etag','size','canonical','timestamp','duplicate','held','remote-absent','accessor','requests','transfer'];
  for(const mode of modes) {
    const f=remoteFixture(2),receipts=f.receipts.map(item=>({...item})),snapshot=f.snapshot();let b=budget();
    const r=receipts[0];
    if(mode==='instance')r.instanceId='44444444-4444-4444-8444-444444444444';
    if(mode==='system')r.databaseSystemIdentifier='9999999999999999999';
    if(mode==='target')r.targetFingerprint='f'.repeat(64);
    if(mode==='storage')r.storageScopeId='f'.repeat(64);
    if(mode==='archive')r.archiveKeyId='f'.repeat(64);
    if(mode==='incomplete')snapshot.complete=false;
    if(mode==='outside')snapshot.objects[0].key='ops/other-instance/object';
    if(mode==='missing')snapshot.objects.pop();
    if(mode==='etag')snapshot.objects[0].etag='"changed"';
    if(mode==='size')snapshot.objects[0].bytes++;
    if(mode==='canonical')r.dumpKey=r.dumpKey.replace('00-01','00-09');
    if(mode==='timestamp')delete r.capturedAt;
    if(mode==='duplicate')receipts[1]={...r};
    if(mode==='held')r.state='prepared';
    if(mode==='remote-absent')r.remoteState='absent';
    if(mode==='accessor')Object.defineProperty(r,'dumpKey',{enumerable:true,get(){assert.fail('Accessor must not execute');}});
    if(mode==='requests')b=createCycleBudget({maxRequestCount:7,maxTransferBytes:256*1024*1024});
    if(mode==='transfer')b=createCycleBudget({maxRequestCount:8,maxTransferBytes:8*STORAGE_LIMITS.controlResponseBytes});
    await assert.rejects(f.adapter.verifyInventory({snapshot,receipts,budget:b,signal:signal()}));assert.equal(f.calls.length,0,mode);
  }
});

test('receipt HEAD/GET/hash drift and conditional read failure hold the entire inventory without retries',async()=>{
  for(const mode of ['head-etag','metadata','recovery-link','get-etag','get-size','hash','conditional-failure']) {
    const f=remoteFixture(2),send=f.client.send;let body;
    f.client.send=async(command,options)=>{
      if(mode==='conditional-failure'&&command.constructor.name==='GetObjectCommand') {f.calls.push({name:'GetObjectCommand',input:command.input});throw Error('synthetic 412; private credential');}
      const result=await send(command,options),get=command.constructor.name==='GetObjectCommand';
      if(mode==='head-etag'&&!get)result.ETag='"changed"';
      if(mode==='metadata'&&!get)result.Metadata={sha256:'f'.repeat(64)};
      if(mode==='recovery-link'&&!get)result.Metadata={...result.Metadata,recovery:f.prefix+'wrong.recovery.json.enc'};
      if(get)body=result.Body;
      if(mode==='get-etag'&&get)result.ETag='"changed"';
      if(mode==='get-size'&&get)result.ContentLength++;
      if(mode==='hash'&&get) {result.Body=Readable.from([Buffer.alloc(result.ContentLength,0)]);body=result.Body;}
      return result;
    };
    await assert.rejects(f.adapter.verifyInventory({snapshot:f.snapshot(),receipts:f.receipts,budget:budget(),signal:signal()}),error=>!error.message.includes('private credential'));
    assert.ok(f.calls.length<=2,mode);assert.equal(f.calls.filter(call=>call.name==='PutObjectCommand').length,0);
    if(['get-etag','get-size'].includes(mode))assert.equal(body.destroyed,true);
  }
});

test('upload allowance is secured before first PUT and unknown PUT consumes it once with no retry',async()=>{
  const f=remoteFixture(),pair=f.pairs[0],pairBytes=pair.bytes.length+pair.recoveryBytes.length;
  const allowance=2*pairBytes+6*STORAGE_LIMITS.controlResponseBytes;
  for(const b of [createCycleBudget({maxRequestCount:5,maxTransferBytes:allowance}),createCycleBudget({maxRequestCount:6,maxTransferBytes:allowance-1})]) {
    await assert.rejects(f.adapter.uploadAndVerify(pair,{budget:b,signal:signal()}));assert.equal(f.calls.length,0);
  }
  const b=createCycleBudget({maxRequestCount:6,maxTransferBytes:allowance});let count=0;
  f.client.send=async()=>{count++;assert.deepEqual(b.snapshot(),{requestCount:6,transferBytes:allowance});throw Error('unknown PUT; private credential');};
  await assert.rejects(f.adapter.uploadAndVerify(pair,{budget:b,signal:signal()}),error=>!error.message.includes('private credential'));
  assert.equal(count,1);assert.deepEqual(b.snapshot(),{requestCount:6,transferBytes:allowance});
});

test('changed scope or invalid encrypted archive is rejected before upload, without writing a partial pair',async()=>{
  const f=remoteFixture(),pair=f.pairs[0];
  const invalid=Buffer.alloc(pair.bytes.length,0);
  for(const candidate of [{...pair,key:pair.key.replace(f.config.instanceId,'44444444-4444-4444-8444-444444444444')},
    {...pair,bytes:invalid,sha256:sha256(invalid)}, {...pair,recoverySha256:'f'.repeat(64)}]) {
    await assert.rejects(f.adapter.uploadAndVerify(candidate,{budget:budget(),signal:signal()}));assert.equal(f.calls.length,0);
  }
});

test('full-cycle bounds cover before/after listing, all known GETs and one newpair, without admitting overflow',()=>{
  const f=remoteFixture(2),maxPairBytes=1000,bounds=inventoryBounds({inventoryLimit:20,receipts:f.receipts,maxPairBytes});
  const pairBytes=f.receipts.reduce((total,item)=>total+item.remoteBytes,0),pageLimit=2;
  assert.deepEqual(bounds,{requestCount:2*pageLimit+8*2+10,
    transferBytes:2*pairBytes+3*maxPairBytes+2*pageLimit*STORAGE_LIMITS.listPageBytes+(8*2+10)*STORAGE_LIMITS.controlResponseBytes});
  assert.equal(BACKUP_LIMITS.dumpBytes,128*1024*1024);assert.equal(BACKUP_LIMITS.sqlBytes,16*1024*1024);
});

test('real SDK parser receives bounded control XML only; oversized raw stream aborts before deserialization',async()=>{
  for(const mode of ['valid','list-overflow','headers-overflow','error-overflow']) {
    const f=remoteFixture();let calls=0,body,options;
    const handler={metadata:{handlerProtocol:'http/1.1'},async handle(request) {
      calls++;assert.equal(request.query['list-type'],'2');
      const content=mode==='list-overflow'?Buffer.alloc(STORAGE_LIMITS.listPageBytes+1,1):mode==='error-overflow'?Buffer.alloc(STORAGE_LIMITS.controlResponseBytes+1,1):
        Buffer.from('<ListBucketResult><Name>synthetic</Name><Prefix>'+f.prefix+'</Prefix><KeyCount>0</KeyCount><MaxKeys>3</MaxKeys><IsTruncated>false</IsTruncated></ListBucketResult>');
      body=Readable.from([content]);
      return {response:{statusCode:mode==='error-overflow'?500:200,headers:{'content-type':'application/xml',...(mode==='headers-overflow'?{'x-overflow':'x'.repeat(STORAGE_LIMITS.listPageBytes+1)}:{})},body}};
    },destroy(){}};
    const adapter=createAdapters(f.config,f.env,{...f.dependencies,createHttpHandler:()=>handler,createStorage:config=>{options=config;return new S3Client(config);}});
    if(mode==='valid')assert.deepEqual(await adapter.listInventory({prefix:f.prefix,inventoryLimit:2,budget:budget(),signal:signal()}),{complete:true,objects:[]});
    else await assert.rejects(adapter.listInventory({prefix:f.prefix,inventoryLimit:2,budget:budget(),signal:signal()}));
    assert.equal(options.maxAttempts,1);assert.equal(options.region,'auto');
    assert.deepEqual(Object.fromEntries(['defaultsMode','retryMode','authSchemePreference','disableS3ExpressSessionAuth','sigv4aSigningRegionSet',
      'useArnRegion','useDualstackEndpoint','useFipsEndpoint','userAgentAppId','requestChecksumCalculation','responseChecksumValidation'].map(key=>[key,options[key]])),
    {defaultsMode:'standard',retryMode:'standard',authSchemePreference:['aws.auth#sigv4'],disableS3ExpressSessionAuth:true,sigv4aSigningRegionSet:[],
      useArnRegion:false,useDualstackEndpoint:false,useFipsEndpoint:false,userAgentAppId:'tuat-pc-backup',requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
    assert.equal(options.credentials.accessKeyId,f.env.R2_ACCESS_KEY_ID);assert.equal(options.credentials.secretAccessKey,f.env.R2_SECRET_ACCESS_KEY);
    await assert.rejects(options.credentialDefaultProvider()(),/Dedicated backup storage credentials required/);
    assert.equal(calls,1);if(mode!=='valid')assert.equal(body.destroyed,true);adapter.close();
  }
});

test('real SDK PUT/HEAD control responses are capped before another pair operation or retry',async()=>{
  for(const stage of ['put','head']) {
    const f=remoteFixture(),pair=f.pairs[0];let count=0,body;
    const handler={metadata:{handlerProtocol:'http/1.1'},async handle(request) {
      count++;const oversized=stage==='put'?request.method==='PUT':request.method==='HEAD';
      body=Readable.from([oversized?Buffer.alloc(STORAGE_LIMITS.controlResponseBytes+1):Buffer.alloc(0)]);
      return {response:{statusCode:200,headers:{},body}};
    },destroy(){}};
    const adapter=createAdapters(f.config,f.env,{...f.dependencies,createHttpHandler:()=>handler,createStorage:options=>new S3Client(options)});
    await assert.rejects(adapter.uploadAndVerify(pair,{budget:budget(),signal:signal()}));
    assert.equal(count,stage==='put'?1:2);assert.equal(body.destroyed,true);adapter.close();
  }
});

test('unverifiable remote identity stops the pair without another PUT or silent GET-body retention',async()=>{
  for(const mode of ['missing','invalid','changed']){
    const f=adapterFixture(),key='d'.repeat(64),pair=encryptedPair({dump:Buffer.from('PGDMPsynthetic'),recovery:{version:1,vault:[],cron:{installed:false,jobs:[]},pushEnv:null},
      instanceId:f.config.instanceId,key,stamp:'2026-10-11T00-30-00-000Z'});
    const calls=[],objects=new Map();let body;
    const client={async send(command){
      const input=command.input;calls.push(command.constructor.name);
      if(command.constructor.name==='PutObjectCommand'){objects.set(input.Key,{bytes:input.Body,metadata:input.Metadata});return {};}
      const object=objects.get(input.Key),get=command.constructor.name==='GetObjectCommand';
      if(get)body=Readable.from([object.bytes]);
      return {ContentLength:object.bytes.length,Metadata:object.metadata,ETag:mode==='missing'?undefined:mode==='invalid'?'bad\n':get?'"changed"':'"original"',...(get?{Body:body}:{})};
    },destroy(){}};
    const adapter=createAdapters(f.config,{PC_BACKUP_ENCRYPTION_KEY:key,R2_ACCOUNT_ID:'e'.repeat(32),R2_ACCESS_KEY_ID:'synthetic',R2_SECRET_ACCESS_KEY:'synthetic',R2_BUCKET_NAME:'synthetic'},
      {...f.dependencies,createStorage:()=>client});
    await assert.rejects(adapter.uploadAndVerify(pair,{signal:new AbortController().signal}));
    assert.equal(calls.filter(name=>name==='PutObjectCommand').length,1);assert.equal(calls.length,mode==='changed'?3:2);
    if(body)assert.equal(body.destroyed,true);
  }
});
