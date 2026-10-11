import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startBackupSupervisor,backupPlan } from './run.mjs';
import { backupStatusReady,STATUS_FILE,BACKUP_INTERVAL_MS,BACKUP_MAX_AGE_MS } from './status.mjs';
import { decryptBackup,verifyRecovery } from '../laptop/backup-backend.mjs';
import { encryptedPair } from './archive.mjs';

const instanceId='11111111-1111-4111-8111-111111111111',generation='22222222-2222-4222-8222-222222222222';
const config={version:1,enabled:true,instanceId,stateDirectory:resolve('synthetic-backup-state'),environmentFile:resolve('synthetic-config/backup.env'),
  wslExecutable:resolve('synthetic-wsl.exe'),wslSha256:'a'.repeat(64),wslDistribution:'synthetic',wslUser:'synthetic',dockerExecutable:'/usr/bin/docker',dockerSha256:'b'.repeat(64),
  psqlExecutable:'/usr/bin/psql',pgDumpExecutable:'/usr/bin/pg_dump',pushEnvironmentFile:null,
  target:{containerId:'c'.repeat(64),containerImageId:`sha256:${'d'.repeat(64)}`,databaseSystemIdentifier:'1234567890123456789',databaseName:'postgres',
    containerName:'synthetic-db',composeProject:'synthetic-backup',composeService:'db',dataMountSource:'/synthetic-owned/database'}};
const env={PC_BACKUP_ENCRYPTION_KEY:'e'.repeat(64),R2_ACCOUNT_ID:'f'.repeat(32),R2_ACCESS_KEY_ID:'synthetic-key',R2_SECRET_ACCESS_KEY:'synthetic-secret',R2_BUCKET_NAME:'synthetic-only'};
const dump=Buffer.from('PGDMPsynthetic-not-a-real-database');
const recovery={version:1,vault:[],pushEnv:null,cron:{installed:true,jobs:[]}};
const flush=async()=>{for(let i=0;i<8;i++) await new Promise(done=>setImmediate(done));};
function fixture(overrides={}) {
  let time=Date.parse('2026-10-11T00:30:00.000Z'),callback,owns=true;
  const files=new Map(),calls={probe:0,dump:0,recovery:0,upload:0,release:0,close:0},events=[];
  const adapters={
    async probe(){calls.probe++;return structuredClone(config.target);},
    async dump(){calls.dump++;return dump;},async recovery(){calls.recovery++;return structuredClone(recovery);},
    async uploadAndVerify(){calls.upload++;return {verified:true};},close(){calls.close++;},...overrides};
  const options={config,env,expectedInstanceId:instanceId,expectedDatabaseSystemIdentifier:config.target.databaseSystemIdentifier,generation,adapters,
    now:()=>time,setTimer:fn=>{callback=fn;return 1;},clearTimer:()=>{callback=null;},report:value=>events.push(value),
    save:(file,value)=>files.set(file,Buffer.isBuffer(value)?Buffer.from(value):structuredClone(value)),
    lock:()=>({assertOwned(){if(!owns) throw Error('synthetic ownership lost');},release(){if(!owns) throw Error('synthetic ownership lost');calls.release++;owns=false;}})};
  return {options,calls,files,events,adapters,advance:ms=>{time+=ms;},pulse:async()=>{callback?.();await flush();},loseLock:()=>{owns=false;},
    status:()=>files.get(resolve(config.stateDirectory,STATUS_FILE)),ready:identity=>backupStatusReady(files.get(resolve(config.stateDirectory,STATUS_FILE)),{...identity,databaseSystemIdentifier:config.target.databaseSystemIdentifier},time)};
}
test('plan is disabled by default and never calls any transport',()=>{
  const plan=backupPlan({...config,enabled:false});assert.equal(plan.enabled,false);for(const key of ['starts','targetReads','providerReads','providerWrites']) assert.equal(plan[key],false);
});
test('disabled and host target mismatches reject before lock, probe or bytes',async()=>{
  for(const update of [{config:{...config,enabled:false}},{expectedInstanceId:'33333333-3333-4333-8333-333333333333'},{expectedDatabaseSystemIdentifier:'9876543210987654321'}]) {
    const f=fixture();let locks=0;await assert.rejects(startBackupSupervisor({...f.options,...update,lock:()=>{locks++;throw Error('unexpected');}}));
    assert.equal(locks,0);assert.equal(f.calls.probe,0);assert.equal(f.files.size,0);
  }
});
test('first same-generation pair is mandatory; old status never unlocks startup',async()=>{
  let complete;const f=fixture({dump:()=>new Promise(done=>{complete=done;})});
  f.files.set(resolve(config.stateDirectory,STATUS_FILE),{old:'untrusted previous lifecycle'});
  const life=await startBackupSupervisor(f.options);await flush();
  assert.equal(f.status().backup,null);assert.equal(f.ready(life.identity),false);
  complete(dump);await flush();assert.equal(f.ready(life.identity),true);assert.equal(f.calls.upload,1);assert.equal((await life.stop()).drained,true);
});
test('existing crypto format and paired recovery authenticated after local encrypted writes',async()=>{
  const f=fixture();const life=await startBackupSupervisor(f.options);await flush();
  const files=[...f.files.entries()].filter(([,value])=>Buffer.isBuffer(value));assert.equal(files.length,2);
  const main=files.find(([name])=>name.includes('backup-2026')),metadata=files.find(([name])=>name.includes('recovery-2026'));
  assert.deepEqual(decryptBackup(main[1],env.PC_BACKUP_ENCRYPTION_KEY),dump);
  verifyRecovery(decryptBackup(metadata[1],env.PC_BACKUP_ENCRYPTION_KEY),dump,instanceId);
  assert.equal(f.ready(life.identity),true);await life.stop();
});
test('15 minute interval and no overlap even while a dump remains in flight',async()=>{
  let complete;const f=fixture({dump:()=>{f.calls.dump++;return new Promise(done=>{complete=done;});}});
  const life=await startBackupSupervisor(f.options);await flush();assert.equal(f.calls.dump,1);
  f.advance(BACKUP_INTERVAL_MS);await f.pulse();assert.equal(f.calls.dump,1);assert.ok(f.calls.probe>=2);
  complete(dump);await flush();await f.pulse();assert.equal(f.calls.dump,2);complete(dump);await flush();await life.stop();
});
test('uncertain upload keeps only prior same-generation pair until strict 35 minute bound, with no replay',async()=>{
  const keys=[];const f=fixture({async uploadAndVerify(pair){f.calls.upload++;keys.push(pair.key);if(keys.length>1) throw Error('synthetic uncertain provider result');return {verified:true};}});
  const life=await startBackupSupervisor(f.options);await flush();const first=f.status().backup;
  f.advance(BACKUP_INTERVAL_MS);await f.pulse();assert.equal(f.ready(life.identity),true);assert.deepEqual(f.status().backup,first);
  assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1]);assert.equal([...f.files.values()].filter(Buffer.isBuffer).length,4);
  f.advance(BACKUP_MAX_AGE_MS-BACKUP_INTERVAL_MS);await f.pulse();assert.equal(f.ready(life.identity),false);assert.equal(keys.length,3);
  assert.deepEqual(f.status().backup,first);await life.stop();
});
test('bad target probe immediately closes despite previously fresh pair',async()=>{
  const f=fixture();const life=await startBackupSupervisor(f.options);await flush();assert.equal(f.ready(life.identity),true);
  f.adapters.probe=async()=>({...config.target,databaseSystemIdentifier:'9876543210987654321'});await f.pulse();
  assert.equal(f.ready(life.identity),false);assert.equal(f.status().target.healthy,false);assert.equal(f.calls.upload,1);await life.stop();
});
test('target changes after upload cannot attest an otherwise verified pair',async()=>{
  const f=fixture({async uploadAndVerify(){f.calls.upload++;f.adapters.probe=async()=>({...config.target,containerId:'9'.repeat(64)});return {verified:true};}});
  const life=await startBackupSupervisor(f.options);await flush();assert.equal(f.calls.upload,1);assert.equal(f.status().backup,null);assert.equal(f.ready(life.identity),false);await life.stop();
});
test('lost owner lock aborts work and closes a fresh generation',async()=>{
  const f=fixture();const life=await startBackupSupervisor(f.options);await flush();f.loseLock();await f.pulse();
  assert.equal(f.ready(life.identity),false);assert.equal(f.calls.upload,1);assert.equal((await life.stop()).drained,false);assert.equal(f.calls.release,0);
});
test('backwards UTC clock closes instead of freshening old timestamps',async()=>{
  const f=fixture();const life=await startBackupSupervisor(f.options);await flush();f.advance(-1);await f.pulse();
  assert.equal(f.ready(life.identity),false);await life.stop();
});
test('stop protects immediately and drains boundedly, retaining lock for noncooperative in-flight operation',async()=>{
  let finish;const f=fixture({dump:()=>new Promise(done=>{finish=done;})});const life=await startBackupSupervisor({...f.options,drainMilliseconds:1});await flush();
  const stopped=await life.stop();assert.equal(stopped.drained,false);assert.equal(f.status().heartbeat.maintenance,true);assert.equal(f.calls.release,0);
  finish(dump);await flush();assert.equal(f.calls.upload,0);assert.equal(f.status().backup,null);
  assert.equal((await life.stop()).drained,false);assert.equal(f.calls.release,0);
});
test('incomplete encryption/recovery pair rejected before upload',()=>{
  assert.throws(()=>encryptedPair({dump:Buffer.from('invalid'),recovery,instanceId,key:env.PC_BACKUP_ENCRYPTION_KEY,stamp:'synthetic'}));
  assert.throws(()=>encryptedPair({dump,recovery:{version:2},instanceId,key:env.PC_BACKUP_ENCRYPTION_KEY,stamp:'synthetic'}));
});
test('uncertain WSL child outcome retains lock even after the parent promise settles',async()=>{
  const f=fixture({async dump(){throw Error('synthetic uncertain WSL child');},isDrained:()=>false});
  const life=await startBackupSupervisor(f.options);await flush();assert.equal(f.ready(life.identity),false);
  assert.equal((await life.stop()).drained,false);assert.equal(f.calls.release,0);
});
test('fatal ownership/clock/publish failures notify owning host exactly once; callback failures are caught',async()=>{
  for(const type of ['ownership','clock','publish']) {
    const notices=[],f=fixture();let publishFails=false;
    const originalSave=f.options.save;
    const life=await startBackupSupervisor({...f.options,onFatal:async value=>{notices.push(value);throw Error('synthetic callback failed');},
      save:(...args)=>{if(publishFails) throw Error('synthetic disk failure');originalSave(...args);}});await flush();
    if(type==='ownership') f.loseLock();if(type==='clock') f.advance(-1);if(type==='publish') publishFails=true;
    await f.pulse();await f.pulse();assert.equal(notices.length,1);assert.equal(notices[0].reason,`${type==='ownership'?'ownership':type==='clock'?'clock':'status-publish'}-unverified`);
    await life.stop();assert.equal(notices.length,1);
  }
});
test('recoverable target and upload failures do not ask owning host to stop',async()=>{
  let notices=0;const f=fixture();const life=await startBackupSupervisor({...f.options,onFatal:()=>{notices++;}});await flush();
  f.adapters.uploadAndVerify=async()=>{throw Error('synthetic upload failure');};f.advance(BACKUP_INTERVAL_MS);await f.pulse();assert.equal(notices,0);
  f.adapters.probe=async()=>{throw Error('synthetic target failure');};await f.pulse();assert.equal(notices,0);assert.equal(f.ready(life.identity),false);await life.stop();
});
