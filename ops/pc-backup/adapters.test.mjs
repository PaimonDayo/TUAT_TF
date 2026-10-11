import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { boundedReadback,createAdapters } from './adapters.mjs';
import { sha256,encryptedPair } from './archive.mjs';
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
    const object=objects.get(input.Key);return {ContentLength:object.bytes.length,Metadata:object.metadata,ETag:'"'+object.metadata.sha256+'"',...(command.constructor.name==='GetObjectCommand'?{Body:Readable.from([object.bytes])}:{})};
  },destroy(){}};
  const adapter=createAdapters(f.config,{PC_BACKUP_ENCRYPTION_KEY:key,R2_ACCOUNT_ID:'e'.repeat(32),R2_ACCESS_KEY_ID:'synthetic',R2_SECRET_ACCESS_KEY:'synthetic',R2_BUCKET_NAME:'synthetic'},
    {...f.dependencies,createStorage:()=>client});
  assert.deepEqual(await adapter.uploadAndVerify(pair,{signal:new AbortController().signal}),{verified:true,dumpEtag:'"'+pair.sha256+'"',recoveryEtag:'"'+pair.recoverySha256+'"'});
  assert.deepEqual(calls,['PutObjectCommand','HeadObjectCommand','GetObjectCommand','PutObjectCommand','HeadObjectCommand','GetObjectCommand']);
  client.send=async()=>{calls.push('uncertain');throw Error('synthetic unknown PUT');};
  await assert.rejects(adapter.uploadAndVerify(pair,{signal:new AbortController().signal}));assert.equal(calls.filter(value=>value==='uncertain').length,1);
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
