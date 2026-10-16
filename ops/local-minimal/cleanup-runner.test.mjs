import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {producerFlockProof,snapshotProducerOwner,runSnapshotCleanup,SNAPSHOT_CLEANUP_POLICY} from './cleanup-runner.mjs';

const now=Date.parse('2026-10-15T03:00:00.000Z'),sourceId='11111111-1111-4111-8111-111111111111',generation='22222222-2222-4222-8222-222222222222';
const hash=data=>createHash('sha256').update(data).digest('hex');
const data=value=>Buffer.from(JSON.stringify(value));
const config={version:1,enabled:true,profile:'pc-private',sourceId,databaseSystemIdentifier:'1234567890123456789',imageRoot:'/var/lib/tuat-local/images',
  producerReceiptFile:'/var/lib/tuat-local/backup/receipt.json',stateDirectory:'/var/lib/tuat-local/offsite-private',environmentFile:'/var/lib/tuat-local/private/r2.env',bucket:'synthetic-backup'};

test('exclusive writer proof requires the exact root producer whole-file FLOCK',()=>{
  const good='12: FLOCK ADVISORY WRITE 1234 08:11:9000 0 EOF\n';
  assert.deepEqual(producerFlockProof(good,{pid:1234,dev:2065n,ino:9000n}),{pid:1234,dev:'2065',ino:'9000'});
  for(const raw of [good.replace('WRITE','READ'),good.replace('FLOCK','POSIX'),good.replace('1234','9999'),good.replace('9000','9001'),
    good.replace('08:11','08:12'),good.replace(' 0 EOF',' 5 EOF'),'12: -> FLOCK ADVISORY WRITE 1234 08:11:9000 0 EOF\n',good+good]) {
    assert.throws(()=>producerFlockProof(raw,{pid:1234,dev:2065n,ino:9000n}));
  }
});

function ownerFixture() {
  const pid=1234,configPath='/var/lib/tuat-local/private/producer.json',root='/var/lib/tuat-local/backup',files=new Map(),proc=new Map();
  const parent={version:1,profile:'pc-private',sourceId,backupRoot:root,receiptFile:config.producerReceiptFile,imageRoot:config.imageRoot,
    periodic:{enabled:true},runtimeKey:'/private/runtime.key',recoveryKeyCopy:'/private/recovery.key'};
  const receipt={version:1,sourceId,databaseSystemIdentifier:config.databaseSystemIdentifier,imageRoot:config.imageRoot,independentRecoveryCopyChecked:true};
  const owner={pid,birthTicks:12345,bootId:'33333333-3333-4333-8333-333333333333',invocationId:'a'.repeat(32),
    controlGroup:'/system.slice/tuat-local-backup.service',sourceId,configSha256:hash(data(parent))};
  const attempt={version:1,sourceId,phase:'offsite-started',identity:owner,receiptHash:hash(data(receipt))};
  files.set(configPath,data(parent));files.set(config.producerReceiptFile,data(receipt));files.set(`${root}/periodic-attempt.json`,data(attempt));
  const rest=Array(20).fill('0');rest[0]='S';rest[19]=String(owner.birthTicks);
  proc.set(`/proc/${pid}/stat`,`${pid} (python3) ${rest.join(' ')}`);proc.set(`/proc/${pid}/status`,'Uid:\t0\t0\t0\t0\n');
  proc.set(`/proc/${pid}/cmdline`,['/usr/bin/python3','-I',fileURLToPath(new URL('./backup.py',import.meta.url)),'--config',configPath,'--execute',''].join('\0'));
  proc.set(`/proc/${pid}/environ`,`INVOCATION_ID=${owner.invocationId}\0`);proc.set(`/proc/${pid}/cgroup`,`0::${owner.controlGroup}\n`);
  proc.set('/proc/sys/kernel/random/boot_id',owner.bootId);proc.set('/proc/locks',`12: FLOCK ADVISORY WRITE ${pid} 08:11:9000 0 EOF\n`);
  const stat={dev:2065n,ino:9000n,nlink:1n,uid:0n,mode:0o100600n,isFile:()=>true,isSymbolicLink:()=>false};
  const read=path=>{assert(files.has(path),path);return files.get(path);};
  const options={read,readProc:path=>Buffer.from(proc.get(path)),parentPid:pid,privateStat:()=>stat};
  return {files,proc,stat,owner,attempt,parent,options};
}

test('direct-child owner binds process birth, boot, invocation, current receipt and inode without acquiring another lock',()=>{
  const f=ownerFixture(),proof=snapshotProducerOwner(config,f.options);assert.equal(proof.ownerToken.length,64);assert.equal(proof.receiptDigest,f.attempt.receiptHash);
  for(const mutate of [f=>f.proc.set('/proc/1234/stat',f.proc.get('/proc/1234/stat').replace('12345','12346')),
    f=>f.proc.set('/proc/locks','12: FLOCK ADVISORY WRITE 9999 08:11:9000 0 EOF\n'),f=>f.stat.nlink=2n,
    f=>f.proc.set('/proc/1234/status','Uid:\t65530\t65530\t65530\t65530\n'),f=>f.proc.set('/proc/sys/kernel/random/boot_id','another-boot'),
    f=>{f.attempt.phase='verified';f.files.set('/var/lib/tuat-local/backup/periodic-attempt.json',data(f.attempt));},
    f=>f.files.set(config.producerReceiptFile,data({...f.parent,extra:'different-current-receipt'}))]) {
    const changed=ownerFixture();mutate(changed);assert.throws(()=>snapshotProducerOwner(config,changed.options));
  }
});

function runnerFixture(mode) {
  const key=Buffer.alloc(32,5),environment=Buffer.from(`R2_ACCOUNT_ID=${'a'.repeat(32)}\nR2_BUCKET_NAME=${config.bucket}\nPC_BACKUP_ENCRYPTION_KEY=${key.toString('hex')}\n`);
  const scope={sourceId,databaseSystemIdentifier:config.databaseSystemIdentifier,storageScopeId:hash(JSON.stringify({account:'a'.repeat(32),bucket:config.bucket})),archiveKeyId:hash(key)};
  const policy={version:1,enabled:true,immutableSourceNamespace:true,...scope,...(mode?{mode}:{})};
  const captured='2026-10-15T02:59:00.000Z',restored='2026-10-15T02:59:10.000Z',archiveSha256='c'.repeat(64),archiveKey=`ops/pc-backend/${sourceId}/backups/test.local.tar.enc`;
  const receipt={sourceId,databaseSystemIdentifier:config.databaseSystemIdentifier,imageRoot:config.imageRoot,independentRecoveryCopyChecked:true,
    recoveryKeyFingerprint:scope.archiveKeyId,archiveSha256,verifiedAt:captured,restoreVerifiedAt:restored};
  const parentConfig={runtimeKey:'/private/runtime.key',recoveryKeyCopy:'/private/recovery.key'};
  const owned={ownerToken:'verified-exclusive-parent-token',receiptDigest:'stable-producer-receipt',receipt,parentConfig};
  const files=new Map([[SNAPSHOT_CLEANUP_POLICY,data(policy)],[config.environmentFile,environment],[parentConfig.runtimeKey,key],[parentConfig.recoveryKeyCopy,key]]);
  const events=[],outcomes=[],faults={};let ownerCalls=0;
  const options={client:{},now:()=>now,read(path){if(!files.has(path))throw Object.assign(Error('No file'),{code:'ENOENT'});return files.get(path);},
    owner(){ownerCalls++;if(faults.owner&&ownerCalls>1)return {...owned,ownerToken:'changed-owner-token'};return owned;},
    async dryRun(cfg,callbacks){events.push('dry-run');assert.equal(cfg,config);
      const identity={...scope,generation};const lock=await callbacks.assertExclusiveLifecycleWriter({identity,prefix:`ops/pc-backend/${sourceId}/backups/`});assert.equal(lock.exclusive,true);
      const proof=await callbacks.verifyRetainedRecovery({identity,snapshot:{archiveKey,archiveSha256,capturedAt:captured,restoreVerifiedAt:restored}});assert.equal(proof.verified,true);
      if(faults.dryRun)throw Error('Private secret must never be included in outcome');
      return {previewDigest:'d'.repeat(64),plan:{local:{removalCandidates:faults.empty||faults.only?[]:[{}]},
        remote:{removalCandidates:faults.only==='remote'?[{}]:[]}},metadataCandidates:faults.only==='metadata'?[{}]:[]};},
    async apply(cfg,preview,callbacks){events.push('apply');assert.equal(callbacks.maxOperations,8);if(faults.apply)throw Error('Unknown delete result');return {completed:1,remaining:0};},
    async writeOutcome(cfg,value){assert.equal(cfg,config);if(faults.write)throw Error('Private disk failed');outcomes.push(value);},onHeld(){events.push('held');}};
  return {options,policy,files,events,outcomes,faults,scope,parentConfig};
}

test('policy absence is opt-out and a present policy defaults to review only',async()=>{
  const absent=runnerFixture();absent.files.delete(SNAPSHOT_CLEANUP_POLICY);assert.equal((await runSnapshotCleanup(config,absent.options)).state,'disabled');assert.deepEqual(absent.events,[]);
  const f=runnerFixture(),result=await runSnapshotCleanup(config,f.options);assert.equal(result.state,'dry-run');assert.deepEqual(f.events,['dry-run']);assert.equal(f.outcomes.length,1);
  const apply=runnerFixture('apply');assert.equal((await runSnapshotCleanup(config,apply.options)).state,'applied');assert.deepEqual(apply.events,['dry-run','apply']);
});

test('zero candidates retain preview safety proofs but never enter apply or create a deletion intent',async()=>{
  const f=runnerFixture('apply');f.faults.empty=true;
  f.options.apply=async()=>assert.fail('empty cleanup must not re-read archives or enter deletion apply');
  const outcome=await runSnapshotCleanup(config,f.options);
  assert.equal(outcome.state,'dry-run');assert.equal(outcome.reasonCode,'no-removal-candidates');
  assert.deepEqual(outcome.counts,{local:0,remote:0,metadata:0});assert.deepEqual(f.events,['dry-run']);
  assert.equal(f.outcomes.length,1);
  const changed=runnerFixture('apply');changed.faults.empty=true;changed.faults.owner=true;
  assert.equal((await runSnapshotCleanup(config,changed.options)).state,'held');assert(!changed.events.includes('apply'));
});

test('remote-only and metadata-only removal plans still enter the guarded apply path',async()=>{
  for(const only of ['remote','metadata']) {
    const f=runnerFixture('apply');f.faults.only=only;
    const outcome=await runSnapshotCleanup(config,f.options);
    assert.equal(outcome.state,'applied');assert.deepEqual(f.events,['dry-run','apply']);
    assert.equal(outcome.counts[only],1);assert.equal(outcome.counts.local,0);
  }
});

test('wrong policy scope, changed producer owner or mismatched independent key is held without losing backup ACK',async()=>{
  for(const mutate of [f=>{f.policy.archiveKeyId='f'.repeat(64);f.files.set(SNAPSHOT_CLEANUP_POLICY,data(f.policy));},f=>f.faults.owner=true,
    f=>f.files.set(f.parentConfig.recoveryKeyCopy,Buffer.alloc(32,9)),f=>f.faults.dryRun=true,f=>f.faults.apply=true]) {
    const f=runnerFixture('apply');mutate(f);const outcome=await runSnapshotCleanup(config,f.options);assert.equal(outcome.state,'held');
    assert.equal(outcome.reasonCode,'retention-proof-unavailable');assert(!JSON.stringify(outcome).includes('secret'));assert(f.events.includes('held'));
  }
  const failedWrite=runnerFixture('apply');failedWrite.faults.write=true;assert.equal((await runSnapshotCleanup(config,failedWrite.options)).state,'applied');assert(failedWrite.events.includes('held'));
});
