import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,link,symlink,rename,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {dryRunSnapshotCleanup,applySnapshotCleanup,verifySnapshotCiphertext,removeSnapshotCiphertext,createSnapshotCleanupAdapter,
  planCompletedSnapshotMetadata} from './snapshot-cleanup.mjs';
import {planSnapshotRetention} from './snapshot-retention.mjs';

const NOW=Date.parse('2026-10-15T03:00:00.000Z'),MINUTE=60_000;
const sha=data=>createHash('sha256').update(data).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const identity={sourceId:'11111111-1111-4111-8111-111111111111',storageScopeId:'a'.repeat(64),archiveKeyId:'b'.repeat(64),
  databaseSystemIdentifier:'1234567890123456789',generation:'22222222-2222-4222-8222-222222222222',startedAt:new Date(NOW-30*MINUTE).toISOString()};
const nonce='33333333-3333-4333-8333-333333333333';
function snapshot(index) {
  const time=NOW-2000-index*15*MINUTE,capturedAt=new Date(time).toISOString();
  return {version:1,state:'verified',storageScopeId:identity.storageScopeId,archiveKeyId:identity.archiveKeyId,objectEtag:`"test-${index}"`,
    localArchiveFile:`/var/lib/tuat-local/backup/snapshot-${index.toString(16).padStart(16,'0')}.tar.enc`,
    format:'tuat-local-db-images-v1',sourceId:identity.sourceId,generation:index===0?identity.generation:'44444444-4444-4444-8444-444444444444',
    databaseSystemIdentifier:identity.databaseSystemIdentifier,imageRoot:'/var/lib/tuat-local/images',
    archiveKey:`ops/pc-backend/${identity.sourceId}/backups/${capturedAt.replace(/[:.]/g,'-')}.local.tar.enc`,archiveSha256:index.toString(16).padStart(64,'0'),
    archiveBytes:64,capturedAt,restoreVerifiedAt:new Date(time+500).toISOString(),offsiteVerifiedAt:new Date(time+1000).toISOString(),independentRecoveryCopyChecked:true};
}
function harness(count=100) {
  const snapshots=Array.from({length:count},(_,i)=>snapshot(i)),local=new Map(),remote=new Map(),intents=new Map(),results=new Map(),events=[];
  for(const [index,s]of snapshots.entries()) {
    local.set(s.localArchiveFile,{path:s.localArchiveFile,dev:'1',ino:String(index+100),nlink:1,bytes:s.archiveBytes,mtimeMs:NOW-index,ctimeMs:NOW-index});
    remote.set(s.archiveKey,{key:s.archiveKey,bytes:s.archiveBytes,etag:s.objectEtag});
  }
  let clock=NOW,binding='fresh-host-environment-and-lock',metadataDigest='receipt-bytes',currentDigest='current-pointer',saved=false;
  const faults={},id=op=>`${op.location}.${op.receiptDigest}`;
  const adapter={conditionalDeleteSupported:true,deletionMode:'if-match',
    async capture(){
      if(faults.incomplete)throw Error('Remote inventory incomplete');
      if([...intents.keys()].some(key=>!results.has(key)))throw Error('Unresolved snapshot deletion requires inspection');
      return {identity,snapshots,protectedSnapshot:snapshots[0],availability:{local:snapshots.filter(s=>local.has(s.localArchiveFile)).map(s=>s.archiveKey),
        remote:snapshots.filter(s=>remote.has(s.archiveKey)).map(s=>s.archiveKey)},proof:{identity,binding,deletionMode:adapter.deletionMode,currentDigest,metadataDigest,
        localFiles:[...local.values()].sort((a,b)=>a.path.localeCompare(b.path)),remoteObjects:[...remote.values()].sort((a,b)=>a.key.localeCompare(b.key))}};
    },
    async assertFresh(proof){assert.equal(proof.binding,binding,'Active host or storage scope changed');assert.equal(proof.currentDigest,currentDigest,'Current snapshot changed');},
    async verifyLocal(s){events.push('verify-local');if(faults.localHash)throw Error('Local ciphertext hash changed');assert(local.has(s.localArchiveFile));},
    async verifyRemote(s){events.push('verify-remote');if(faults.remoteHash)throw Error('Remote ciphertext hash changed');assert.equal(remote.get(s.archiveKey)?.etag,s.objectEtag);},
    async verifyRecovery(s){return {...identity,archiveKey:s.archiveKey,archiveSha256:s.archiveSha256,verified:!faults.recovery,checkedAt:faults.badCheckedAt?'bad':new Date(clock).toISOString()};},
    async lock(){events.push('lock');if(faults.lock)throw Error('Cleanup already running');return async()=>events.push('unlock');},
    async journal(){
      if([...intents.keys()].some(key=>!results.has(key)))throw Error('Unresolved snapshot deletion requires inspection');
      return {done:[...results.keys()],async savePlan(){events.push('save-plan');saved=true;},
        async intent(op){assert(saved);assert(!intents.has(id(op)));intents.set(id(op),op);events.push('durable-intent');},
        async result(op){if(faults.result)throw Error('Journal fsync failed');results.set(id(op),op);events.push('durable-result');}};
    },
    async removeRemote(op){assert(intents.has(id(op)));events.push('delete-remote');remote.delete(op.archiveKey);if(faults.deleteUnknown)throw Error('Connection lost after DELETE');},
    async removeLocal(op){assert(intents.has(id(op)));events.push('delete-local');local.delete(op.localArchiveFile);},
  };
  const options={adapter,now:()=>clock,planNonce:nonce};
  return {adapter,options,local,remote,intents,results,events,faults,snapshots,
    advance:ms=>clock+=ms,changeHost:()=>binding='another-host',changeMetadata:()=>metadataDigest='changed',changeCurrent:()=>currentDigest='new-current'};
}

test('reviewed cleanup keeps current, latest local24/remote96 and unknown files/objects',async()=>{
  const h=harness();const legacyPath='/var/lib/tuat-local/backup/legacy.enc',legacyKey=`ops/pc-backend/${identity.sourceId}/backups/legacy.enc`;
  h.local.set(legacyPath,{path:legacyPath,dev:'1',ino:'999',nlink:1,bytes:9,mtimeMs:NOW,ctimeMs:NOW});
  h.remote.set(legacyKey,{key:legacyKey,bytes:9,etag:'"legacy"'});
  const preview=await dryRunSnapshotCleanup({},h.options);assert(preview.plan.local.removalCandidates.length>0);assert(preview.plan.remote.removalCandidates.length>0);
  assert(!h.events.some(event=>event.startsWith('delete')));assert.equal(h.intents.size,0);
  const result=await applySnapshotCleanup({},preview,h.options);assert.equal(result.applied,true);
  assert(h.local.has(legacyPath)&&h.remote.has(legacyKey));
  for(const s of h.snapshots.slice(0,24))assert(h.local.has(s.localArchiveFile));
  for(const s of h.snapshots.slice(0,96))assert(h.remote.has(s.archiveKey));
  assert(h.local.has(h.snapshots[0].localArchiveFile)&&h.remote.has(h.snapshots[0].archiveKey));
  assert.equal(h.intents.size,h.results.size);
  const next=await dryRunSnapshotCleanup({},h.options);assert.equal(next.plan.local.removalCandidates.length,0);assert.equal(next.plan.remote.removalCandidates.length,0);
});

test('provider without conditional-delete proof refuses before any intent or deletion',async()=>{
  const h=harness(),preview=await dryRunSnapshotCleanup({},h.options);h.adapter.conditionalDeleteSupported=false;
  await assert.rejects(applySnapshotCleanup({},preview,h.options),/conditional DELETE/);assert.equal(h.intents.size,0);assert.equal(h.results.size,0);
  assert.equal(h.events.at(-1),'unlock');
});

test('explicit immutable-namespace mode still binds the same owner scope',async()=>{
  const h=harness();h.adapter.conditionalDeleteSupported=false;h.adapter.deletionMode='immutable-source-namespace';
  const preview=await dryRunSnapshotCleanup({},h.options);h.changeHost();
  await assert.rejects(applySnapshotCleanup({},preview,h.options),/inventory changed/);assert.equal(h.intents.size,0);
  const fresh=harness();fresh.adapter.conditionalDeleteSupported=false;fresh.adapter.deletionMode='immutable-source-namespace';
  const accepted=await dryRunSnapshotCleanup({},fresh.options);assert.equal((await applySnapshotCleanup({},accepted,fresh.options)).applied,true);
});

test('incomplete inventory, ciphertext failure or unverified retained recovery cannot produce a dry run',async()=>{
  for(const fault of ['incomplete','localHash','remoteHash','recovery','badCheckedAt']) {
    const h=harness();h.faults[fault]=true;await assert.rejects(dryRunSnapshotCleanup({},h.options));assert.equal(h.intents.size,0);
  }
});

test('changed actual inventory, receipt bytes, active host or current pointer invalidate review',async()=>{
  for(const mutate of [h=>h.changeHost(),h=>h.changeMetadata(),h=>h.changeCurrent(),h=>h.remote.set('unknown-new-object',{key:'unknown-new-object',bytes:1,etag:'"new"'}),
    h=>h.local.set('unrelated',{path:'unrelated',dev:'1',ino:'888',nlink:1,bytes:1,mtimeMs:NOW,ctimeMs:NOW})]) {
    const h=harness(),preview=await dryRunSnapshotCleanup({},h.options);mutate(h);
    await assert.rejects(applySnapshotCleanup({},preview,h.options),/inventory changed/);assert.equal(h.intents.size,0);
  }
});

test('tampered previews and stale or backwards clocks never authorize deletion',async()=>{
  for(const mutate of [(h,p)=>p.plan.remote.removalCandidates.pop(),(h,p)=>p.proof.identity.archiveKeyId='c'.repeat(64),
    h=>h.advance(15*MINUTE),h=>h.advance(-1)]) {
    const h=harness(),preview=await dryRunSnapshotCleanup({},h.options);mutate(h,preview);
    await assert.rejects(applySnapshotCleanup({},preview,h.options));assert.equal(h.intents.size,0);
  }
});

test('a DELETE with unknown outcome or failed result persistence is never automatically resent',async()=>{
  for(const fault of ['deleteUnknown','result']) {
    const h=harness(),preview=await dryRunSnapshotCleanup({},h.options);h.faults[fault]=true;
    await assert.rejects(applySnapshotCleanup({},preview,h.options));assert.equal(h.intents.size,1);assert.equal(h.results.size,0);
    const deletes=h.events.filter(e=>e.startsWith('delete')).length;h.faults[fault]=false;
    await assert.rejects(applySnapshotCleanup({},preview,h.options),/Unresolved/);
    await assert.rejects(dryRunSnapshotCleanup({},h.options),/Unresolved/);
    assert.equal(h.events.filter(e=>e.startsWith('delete')).length,deletes);
  }
});

test('known completed partial deletion resumes only with the exact remaining inventory',async()=>{
  const h=harness(),preview=await dryRunSnapshotCleanup({},h.options),verify=h.adapter.verifyRemote.bind(h.adapter);let verifies=0;
  h.adapter.verifyRemote=async s=>{if(++verifies===3)throw Error('Pre-intent read failed');return verify(s);};
  await assert.rejects(applySnapshotCleanup({},preview,h.options),/Pre-intent/);assert.equal(h.results.size,1);assert.equal(h.intents.size,1);
  h.adapter.verifyRemote=verify;const result=await applySnapshotCleanup({},preview,h.options);assert.equal(result.resumed,1);assert.equal(h.intents.size,h.results.size);
  const completed=h.events.filter(e=>e.startsWith('delete')).length;
  assert.equal((await applySnapshotCleanup({},preview,h.options)).completed,0);assert.equal(h.events.filter(e=>e.startsWith('delete')).length,completed);
});

test('partial result cannot hide a new object added after review',async()=>{
  const h=harness(),preview=await dryRunSnapshotCleanup({},h.options),verify=h.adapter.verifyRemote.bind(h.adapter);let verifies=0;
  h.adapter.verifyRemote=async s=>{if(++verifies===3)throw Error('Pre-intent read failed');return verify(s);};
  await assert.rejects(applySnapshotCleanup({},preview,h.options));h.adapter.verifyRemote=verify;
  h.remote.set('new-after-partial',{key:'new-after-partial',bytes:1,etag:'"new"'});
  await assert.rejects(applySnapshotCleanup({},preview,h.options),/inventory changed/);assert.equal(h.results.size,1);
});

test('native storage adapter refuses retrying clients before host or storage I/O',async()=>{
  const config={version:1,profile:'pc-private',enabled:true,imageRoot:'/var/lib/tuat-local/images',stateDirectory:resolve(tmpdir()),environmentFile:resolve(tmpdir(),'env')};
  await assert.rejects(createSnapshotCleanupAdapter(config,{client:{config:{maxAttempts:async()=>3}},verifyRetainedRecovery:async()=>{}}),/disable retries/);
});

test('native local hash rejects hardlinks, substituted inode and hash mismatch while preserving files',async()=>{
  const directory=await mkdtemp(resolve(process.cwd(),'.snapshot-cleanup-test-'));
  const archive=resolve(directory,'snapshot.enc'),copy=resolve(directory,'copy.enc'),data=Buffer.concat([Buffer.from('TUATPC01'),Buffer.alloc(56,7)]);
  const receipt={archiveBytes:data.length,archiveSha256:sha(data)};
  try {
    await writeFile(archive,data,{mode:0o600});const proof=await verifySnapshotCiphertext(archive,receipt);assert.equal(proof.nlink,1);
    await assert.rejects(verifySnapshotCiphertext(archive,{...receipt,archiveSha256:'0'.repeat(64)}),/hash changed/);
    if(process.platform!=='win32') {
      await link(archive,copy);await assert.rejects(verifySnapshotCiphertext(archive,receipt),/single-link/);await rm(copy);
    }
    await rename(archive,copy);await writeFile(archive,data,{mode:0o600});
    await assert.rejects(verifySnapshotCiphertext(archive,receipt,proof),/identity changed/);
    assert.deepEqual(await readFile(copy),data);assert.deepEqual(await readFile(archive),data);
    if(process.platform!=='win32') {
      await rm(archive);await symlink(copy,archive);await assert.rejects(verifySnapshotCiphertext(archive,receipt),/single-link/);
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('native local removal uses a checked private quarantine and preserves exchanged files or lost ownership',async()=>{
  for(const mode of ['delete','exchange','lost-owner']) {
    const root=await mkdtemp(resolve(process.cwd(),'.snapshot-cleanup-test-'));
    const archive=resolve(root,'snapshot-0000000000000001.tar.enc'),retained=resolve(root,'original-kept.enc'),data=Buffer.concat([Buffer.from('TUATPC01'),Buffer.alloc(56,7)]);
    const receipt={localArchiveFile:archive,archiveBytes:data.length,archiveSha256:sha(data)};
    try {
      await writeFile(archive,data,{mode:0o600});const expected=await verifySnapshotCiphertext(archive,receipt);let checks=0;
      const run=()=>removeSnapshotCiphertext(receipt,{archiveRoot:root,expected,nonce,assertFresh:async()=>{
        checks++;
        if(mode==='exchange'&&checks===1){await rename(archive,retained);await writeFile(archive,Buffer.alloc(data.length,9),{mode:0o600});}
        if(mode==='lost-owner'&&checks===2)throw Error('Lifecycle owner lost');
      }});
      if(mode==='delete'){await run();assert.deepEqual(await readdir(root),[]);assert.equal(checks,2);}
      else {
        await assert.rejects(run(),mode==='exchange'?/identity changed/:/owner lost/);
        const quarantined=resolve(root,`.snapshot-cleanup-${nonce}`,'snapshot-0000000000000001.tar.enc');
        assert.deepEqual(await readFile(quarantined),mode==='exchange'?Buffer.alloc(data.length,9):data);
        if(mode==='exchange')assert.deepEqual(await readFile(retained),data);
      }
    } finally {await rm(root,{recursive:true,force:true});}
  }
});

test('availability planning independently retains the latest extant copies after prior reclaim',()=>{
  const snapshots=Array.from({length:100},(_,i)=>snapshot(i));
  const result=planSnapshotRetention({identity,snapshots,protectedSnapshot:snapshots[0],planNonce:nonce,now:NOW,
    availability:{local:snapshots.slice(0,24).map(s=>s.archiveKey),remote:snapshots.map(s=>s.archiveKey)}});
  assert(result.planningAllowed);assert.equal(result.local.removalCandidates.length,0);assert(result.remote.removalCandidates.length>0);
  for(const availability of [{local:[],remote:snapshots.map(s=>s.archiveKey)},{local:['unknown'],remote:[]}]) {
    const refused=planSnapshotRetention({identity,snapshots,protectedSnapshot:snapshots[0],planNonce:nonce,now:NOW,availability});
    assert.equal(refused.planningAllowed,false);assert.equal(refused.reason,'availability_unverified');
  }
  let invoked=false;const accessor={remote:[snapshots[0].archiveKey]};
  Object.defineProperty(accessor,'local',{enumerable:true,get(){invoked=true;throw Error('Do not evaluate');}});
  const refused=planSnapshotRetention({identity,snapshots,protectedSnapshot:snapshots[0],planNonce:nonce,now:NOW,availability:accessor});
  assert.equal(refused.planningAllowed,false);assert.equal(invoked,false);
});

function metadataFixture(snapshots,identityValue=identity) {
  const config={profile:'pc-private',sourceId:identityValue.sourceId,databaseSystemIdentifier:identityValue.databaseSystemIdentifier,
    imageRoot:'/var/lib/tuat-local/images',environmentFile:'/private/r2.env',hostConfigFile:'/private/host.json',
    stateDirectory:resolve(process.cwd(),'.synthetic-state'),bucket:'synthetic-backup'};
  const claims=[],stateFiles=[],documents=new Map();
  for(const [index,s]of snapshots.entries()) {
    const stamp=s.capturedAt.replace(/[:.]/g,'-'),intent={version:1,state:'unknown',sourceId:s.sourceId,generation:s.generation,
      capturedAt:s.capturedAt,restoreVerifiedAt:s.restoreVerifiedAt,key:s.archiveKey,sha256:s.archiveSha256,bytes:s.archiveBytes};
    for(const [name,record]of [[`${stamp}.offsite-verified.json`,s],[`${stamp}.offsite-intent.json`,intent]]) {
      claims.push({name,record});stateFiles.push({name,path:resolve(config.stateDirectory,name),sha256:digest(record),dev:'1',ino:String(index*4+1),nlink:1,bytes:100,mtimeMs:NOW,ctimeMs:NOW});
    }
    const name=`producer-${index.toString(16).padStart(32,'0')}.json`,path=resolve(config.stateDirectory,name),record={...config,archiveFile:s.localArchiveFile};
    documents.set(path,record);stateFiles.push({name,path,sha256:digest(record),dev:'1',ino:String(index*4+3),nlink:1,bytes:100,mtimeMs:NOW,ctimeMs:NOW});
  }
  return {config,claims,stateFiles,readJson:path=>documents.get(path)};
}

function metadataHarness() {
  const h=harness(),f=metadataFixture(h.snapshots),capture=h.adapter.capture.bind(h.adapter),journal=h.adapter.journal.bind(h.adapter);
  const states=new Map(h.snapshots.map(s=>[digest(s),{receiptDigest:digest(s),localDeleted:false,remoteDeleted:false}]));
  const removed=new Set(),files=new Map(f.stateFiles.map(file=>[file.name,file]));
  h.adapter.capture=async()=>{
    const current=await capture();current.snapshots=current.snapshots.filter(s=>!removed.has(digest(s)));
    current.stateFiles=[...files.values()].sort((a,b)=>a.name.localeCompare(b.name));
    current.claims=f.claims.filter(claim=>files.has(claim.name));
    current.proof.retirements=current.snapshots.map(s=>({...states.get(digest(s))})).sort((a,b)=>a.receiptDigest.localeCompare(b.receiptDigest));
    current.proof.metadataFiles=current.stateFiles.map(file=>({name:file.name,sha256:file.sha256}));current.proof.metadataDigest=digest(current.proof.metadataFiles);return current;
  };
  h.adapter.planMetadata=async(captured,plan)=>planCompletedSnapshotMetadata(captured,plan,f.config,{readJson:f.readJson});
  h.adapter.verifyMetadata=async(op,proof,requireRetired)=>{
    assert(op.files.every(file=>files.has(file.name)));
    if(requireRetired){assert(!h.local.has(op.localArchiveFile)&&!h.remote.has(op.archiveKey));assert(states.get(op.receiptDigest).localDeleted&&states.get(op.receiptDigest).remoteDeleted);}
  };
  h.adapter.removeMetadata=async op=>{
    await h.adapter.verifyMetadata(op,null,true);h.events.push('delete-metadata');
    for(const file of op.files){files.delete(file.name);if(h.faults.metadataUnknown)throw Error('Metadata unlink outcome unknown');}
    removed.add(op.receiptDigest);
  };
  h.adapter.journal=async preview=>{
    const current=await journal(preview),result=current.result.bind(current);
    current.result=async op=>{await result(op);if(op.location!=='metadata')states.get(op.receiptDigest)[`${op.location}Deleted`]=true;};return current;
  };
  return {...h,states,files,removed};
}

test('metadata executes only after both known deletions, then the same complete preview is safely resumable',async()=>{
  const h=metadataHarness(),preview=await dryRunSnapshotCleanup({},h.options);assert.equal(preview.metadataCandidates.length,4);
  const result=await applySnapshotCleanup({},preview,h.options);assert.equal(result.metadataDeleted,4);assert.equal(h.removed.size,4);
  assert.equal((await applySnapshotCleanup({},preview,h.options)).completed,0);
  const next=await dryRunSnapshotCleanup({},h.options);assert.equal(next.snapshots.length,96);assert.equal(next.metadataCandidates.length,0);
});

test('partially removed metadata remains unknown and cannot be retried as a new cleanup',async()=>{
  const h=metadataHarness(),preview=await dryRunSnapshotCleanup({},h.options);h.faults.metadataUnknown=true;
  await assert.rejects(applySnapshotCleanup({},preview,h.options),/Metadata unlink outcome unknown/);
  assert.equal(h.intents.size-h.results.size,1);h.faults.metadataUnknown=false;
  await assert.rejects(applySnapshotCleanup({},preview,h.options),/Unresolved/);await assert.rejects(dryRunSnapshotCleanup({},h.options),/Unresolved/);
});

test('bounded chunks do not claim unsent removals and may continue from a fresh known inventory',async()=>{
  const h=metadataHarness(),preview=await dryRunSnapshotCleanup({},h.options);
  const result=await applySnapshotCleanup({},preview,{...h.options,maxOperations:8});assert.equal(result.completed,8);assert(result.remaining>0);assert.equal(result.metadataDeleted,0);
  const next=await dryRunSnapshotCleanup({},h.options);assert.equal(next.plan.remote.removalCandidates.length,0);
  assert.equal(h.intents.size,h.results.size);
});

test('metadata cleanup needs exact completed history/intent pairs and never infers known results from absence',()=>{
  const snapshots=Array.from({length:100},(_,i)=>snapshot(i)),f=metadataFixture(snapshots);
  const retired=s=>({receiptDigest:digest(s),localDeleted:false,remoteDeleted:false});
  const captured={identity,snapshots,protectedSnapshot:snapshots[0],claims:f.claims,stateFiles:f.stateFiles,proof:{retirements:snapshots.map(retired)}};
  const plan=planSnapshotRetention({identity,snapshots,protectedSnapshot:snapshots[0],planNonce:nonce,now:NOW});
  const candidates=planCompletedSnapshotMetadata(captured,plan,f.config,{readJson:f.readJson});assert.equal(candidates.length,4);
  assert(candidates.every(op=>op.files.length===3));assert(candidates.every(op=>op.archiveKey!==snapshots[0].archiveKey));
  const unknown=f.claims.find(item=>item.record.key===snapshots[98].archiveKey);unknown.record={...unknown.record,sha256:'f'.repeat(64)};
  captured.claims=captured.claims.filter(item=>!(item.name.endsWith('.offsite-verified.json')&&item.record.archiveKey===snapshots[97].archiveKey));
  const availability={local:snapshots.slice(0,99).map(s=>s.archiveKey),remote:snapshots.slice(0,99).map(s=>s.archiveKey)};
  const absencePlan=planSnapshotRetention({identity,snapshots,protectedSnapshot:snapshots[0],planNonce:nonce,now:NOW,availability});
  const held=planCompletedSnapshotMetadata(captured,absencePlan,f.config,{readJson:f.readJson});assert.equal(held.length,1);assert.equal(held[0].archiveKey,snapshots[96].archiveKey);
});

test('80 daily batches of fifteen-minute snapshots keep recovery anchors and normal metadata bounded',()=>{
  let snapshots=[];const local=new Set(),remote=new Set(),retirements=new Map(),unknownIntent='orphan-unresolved.offsite-intent.json';
  let highWater=0;
  for(let day=0;day<80;day++) {
    const clock=NOW+day*86_400_000,currentIdentity={...identity,startedAt:new Date(clock-30*MINUTE).toISOString()},added=[];
    for(let i=0;i<96;i++) {
      const index=day*96+i,time=clock-2000-i*15*MINUTE,capturedAt=new Date(time).toISOString();
      const s={...snapshot(index),generation:i===0?identity.generation:'44444444-4444-4444-8444-444444444444',capturedAt,
        archiveKey:`ops/pc-backend/${identity.sourceId}/backups/${capturedAt.replace(/[:.]/g,'-')}.local.tar.enc`,
        restoreVerifiedAt:new Date(time+500).toISOString(),offsiteVerifiedAt:new Date(time+1000).toISOString()};
      added.push(s);local.add(s.archiveKey);remote.add(s.archiveKey);retirements.set(digest(s),{receiptDigest:digest(s),localDeleted:false,remoteDeleted:false});
    }
    snapshots=[...added,...snapshots];const f=metadataFixture(snapshots,currentIdentity),current=snapshots[0];
    const availability={local:snapshots.filter(s=>local.has(s.archiveKey)).map(s=>s.archiveKey),remote:snapshots.filter(s=>remote.has(s.archiveKey)).map(s=>s.archiveKey)};
    const plan=planSnapshotRetention({identity:currentIdentity,snapshots,protectedSnapshot:current,planNonce:nonce,now:clock,availability});assert(plan.planningAllowed);
    const captured={identity:currentIdentity,snapshots,protectedSnapshot:current,claims:f.claims,stateFiles:[...f.stateFiles,{name:unknownIntent,path:unknownIntent}],
      proof:{retirements:snapshots.map(s=>retirements.get(digest(s)))}};
    const metadata=planCompletedSnapshotMetadata(captured,plan,f.config,{readJson:f.readJson});
    for(const location of ['local','remote'])for(const op of plan[location].removalCandidates) {
      (location==='local'?local:remote).delete(op.archiveKey);retirements.get(op.receiptDigest)[`${location}Deleted`]=true;
    }
    for(const kept of plan.local.keep)assert(local.has(kept.archiveKey));for(const kept of plan.remote.keep)assert(remote.has(kept.archiveKey));
    assert(local.has(current.archiveKey)&&remote.has(current.archiveKey));
    for(const op of metadata){assert(!local.has(op.archiveKey)&&!remote.has(op.archiveKey));assert(op.files.every(file=>file.name!==unknownIntent));}
    const removed=new Set(metadata.map(op=>op.receiptDigest));snapshots=snapshots.filter(s=>!removed.has(digest(s)));
    for(const key of removed)retirements.delete(key);
    highWater=Math.max(highWater,snapshots.length*3+[...retirements.values()].filter(item=>item.localDeleted||item.remoteDeleted).length+1);
    assert(snapshots.length<=128);assert(local.size<=54);assert(remote.size<=126);
    if(day>=30)assert(new Set(plan.remote.keep.map(s=>new Date(Date.parse(s.capturedAt)+9*60*MINUTE).toISOString().slice(0,10))).size>=30);
  }
  assert(highWater<650);assert.equal(retirements.size,snapshots.length);
});
