import test from 'node:test';
import assert from 'node:assert/strict';
import { planBackupRetention,MAX_RETENTION_INVENTORY } from './retention.mjs';

const now=Date.parse('2026-10-11T02:00:00.000Z');
const uuid=number=>`${String(number).padStart(8,'0')}-1111-4111-8111-111111111111`;
const identity={instanceId:uuid(1),generation:uuid(2),startedAt:new Date(now-10*60_000).toISOString(),databaseSystemIdentifier:'1234567890123456789'};
const scope={targetFingerprint:'a'.repeat(64),storageScopeId:'b'.repeat(64),archiveKeyId:'c'.repeat(64)};
function receipt(number,time,{historical=true,...changes}={}) {
  const capturedAt=new Date(time).toISOString(),dumpBytes=100,recoveryBytes=80;
  const key=`ops/pc-backend/${identity.instanceId}/backups/${capturedAt.replace(/[:.]/g,'-')}.dump.enc`;
  return {version:1,state:'verified',receiptId:uuid(number),instanceId:identity.instanceId,generation:historical?uuid(3):identity.generation,
    startedAt:historical?'2026-08-01T00:00:00.000Z':identity.startedAt,databaseSystemIdentifier:identity.databaseSystemIdentifier,...scope,
    capturedAt,verifiedAt:new Date(time+1000).toISOString(),dumpKey:key,recoveryKey:key.replace('.dump.enc','.recovery.json.enc'),
    dumpSha256:'d'.repeat(64),recoverySha256:'e'.repeat(64),dumpEtag:'"dump-'+number+'"',recoveryEtag:'"recovery-'+number+'"',
    dumpBytes,recoveryBytes,localState:'complete',remoteState:'verified',localBytes:180,remoteBytes:180,...changes};
}
const current=()=>receipt(10,now-60_000,{historical:false});
function input(records=[current()],changes={}) {
  return {identity:{...identity},scope:{...scope},protectedPair:current(),receipts:records,inventoryLimit:512,
    budgets:{maxLocalBytes:1_000_000,maxRemoteBytes:1_000_000,freeLocalBytes:1_000_000,minFreeLocalBytes:1000,
      remoteBaselineBytes:1234,nextPairBytes:200,maxRequestCount:6,maxTransferBytes:400},planNonce:uuid(9),now,...changes};
}
const ids=rows=>new Set(rows.map(row=>row.receiptId));
function blocked(result,reason) {
  assert.equal(result.dryRun,true);assert.equal(result.decision.planningAllowed,false);assert.equal(result.decision.writeAllowed,false);
  if(reason)assert.equal(result.decision.reason,reason);
  assert.deepEqual(result.removalCandidates,{local:[],remote:[]});
}

test('pure plan binds current identity, protected metadata, explicit scope and inventory without mutating inputs',()=>{
  const request=input(),before=structuredClone(request),result=planBackupRetention(request);
  assert.deepEqual(request,before);assert.equal(result.dryRun,true);assert.equal(result.decision.writeAllowed,true);
  assert.deepEqual(result.retained.local.map(row=>row.receiptId),[current().receiptId]);
  assert.equal(result.binding.generation,identity.generation);assert.equal(result.binding.databaseSystemIdentifier,identity.databaseSystemIdentifier);
  assert.match(result.planDigest,/^[a-f0-9]{64}$/);assert.equal(planBackupRetention(request).planDigest,result.planDigest);
  assert.notEqual(planBackupRetention({...request,planNonce:uuid(8)}).planDigest,result.planDigest);
});
test('latest24 local/latest96 remote and latest2 survive even outside the daily window',()=>{
  const records=[current(),...Array.from({length:130},(_,index)=>receipt(index+20,now-40*86_400_000-index*60_000))];
  const result=planBackupRetention(input(records));
  assert.equal(result.retained.local.length,24);assert.equal(result.retained.remote.length,96);
  for(const location of ['local','remote']) {
    assert(ids(result.retained[location]).has(records[0].receiptId));assert(ids(result.retained[location]).has(records[1].receiptId));
    assert(!ids(result.removalCandidates[location]).has(records[0].receiptId));
  }
});
test('current protected pair outside the latest counts and JST anchor remains retained within conservative55/127 bounds',()=>{
  const protectedPair=receipt(10,now-9*60_000,{historical:false,verifiedAt:new Date(now-1000).toISOString()});
  const newer=Array.from({length:130},(_,index)=>receipt(1200+index,now-2*60_000-index*1000));
  const daily=Array.from({length:29},(_,index)=>receipt(1500+index,now-(index+1)*86_400_000));
  const result=planBackupRetention(input([protectedPair,...newer,...daily],{protectedPair}));
  assert.equal(result.decision.planningAllowed,true);
  for(const [location,bound] of [['local',55],['remote',127]]) {
    assert(ids(result.retained[location]).has(protectedPair.receiptId));
    assert(!ids(result.removalCandidates[location]).has(protectedPair.receiptId));
    assert(result.retained[location].length<=bound);
    for(const record of daily)assert(ids(result.retained[location]).has(record.receiptId));
  }
  assert.equal(result.retained.local.length,54);assert.equal(result.retained.remote.length,126);
});
test('JST daily anchors cover each represented calendar day, including UTC/JST midnight boundary',()=>{
  const recent=Array.from({length:110},(_,index)=>receipt(100+index,now-2*60_000-index*30_000));
  const beforeMidnight=receipt(300,Date.parse('2026-10-07T14:59:59.000Z'));
  const afterMidnight=receipt(301,Date.parse('2026-10-07T15:00:00.000Z'));
  const olderSameDay=receipt(302,Date.parse('2026-10-07T00:00:00.000Z'));
  const oldestIncluded=receipt(303,Date.parse('2026-09-11T15:00:00.000Z'));
  const outsideWindow=receipt(304,Date.parse('2026-09-11T14:59:59.000Z'));
  const result=planBackupRetention(input([current(),...recent,beforeMidnight,afterMidnight,olderSameDay,oldestIncluded,outsideWindow]));
  for(const location of ['local','remote']) {
    const kept=ids(result.retained[location]),remove=ids(result.removalCandidates[location]);
    assert(kept.has(beforeMidnight.receiptId));assert(kept.has(afterMidnight.receiptId));assert(kept.has(oldestIncluded.receiptId));
    assert(remove.has(olderSameDay.receiptId));assert(remove.has(outsideWindow.receiptId));
  }
});
test('incomplete, uncertain, legacy, orphan and malformed metadata remain held with no age expiry',()=>{
  const held=['prepared','unknown','legacy','orphan'].map((state,index)=>({state,receiptId:uuid(500+index),localBytes:50,remoteBytes:60,capturedAt:'2020-01-01T00:00:00.000Z'}));
  held.push({...receipt(510,now-40*86_400_000),recoveryKey:null});
  const result=planBackupRetention(input([current(),...held]));
  assert.equal(result.held.count,5);assert.equal(result.held.unknownSizeCount,0);assert.equal(result.quota.current.localBytes,560);
  assert.deepEqual(result.removalCandidates,{local:[],remote:[]});
});
test('malformed unknown-size metadata cannot open a quota decision, and accessors are not evaluated',()=>{
  let called=false;const getter={};Object.defineProperty(getter,'state',{enumerable:true,get(){called=true;throw Error('should not execute');}});
  const result=planBackupRetention(input([current(),getter,{state:'unknown'}]));
  assert.equal(called,false);assert.equal(result.held.count,3);assert.equal(result.held.unknownSizeCount,3);
  blocked(result,'inventory_metadata_unverified');assert.equal(result.quota.decision,'unverified');
  const array=[current(),null];Object.defineProperty(array,1,{get(){called=true;throw Error('should not execute');}});
  assert.equal(planBackupRetention(input(array)).held.count,2);assert.equal(called,false);
  const flatUnknown=planBackupRetention(input([current(),{state:'unknown'}]));
  assert.equal(flatUnknown.held.count,1);assert.equal(flatUnknown.held.unknownSizeCount,1);
  assert.equal(flatUnknown.quota.decision,'unverified');assert.equal(flatUnknown.decision.writeAllowed,false);
});
test('changed instance/database/target/storage/archive-key or current generation fails closed',()=>{
  for(const change of [{instanceId:uuid(5)},{databaseSystemIdentifier:'9999999999999999999'},{generation:uuid(6)},
    {startedAt:new Date(now-20*60_000).toISOString()}])blocked(planBackupRetention(input([current()],{identity:{...identity,...change}})));
  for(const key of Object.keys(scope))blocked(planBackupRetention(input([current()],{scope:{...scope,[key]:'f'.repeat(64)}})));
});
test('conflicting verified historical scope blocks all candidates; old legacy namespace stays held',()=>{
  for(const key of ['databaseSystemIdentifier',...Object.keys(scope)]) {
    const different=receipt(600,now-40*86_400_000,{[key]:key==='databaseSystemIdentifier'?'9999999999999999999':'f'.repeat(64)});
    blocked(planBackupRetention(input([current(),different])),'scope_mismatch');
  }
  const legacy={state:'legacy',instanceId:uuid(7),localBytes:100,remoteBytes:100};
  const result=planBackupRetention(input([current(),legacy]));assert.equal(result.held.count,1);assert.equal(result.decision.planningAllowed,true);
});
test('future lifecycle/receipt clocks and exact35min protected-pair expiry fail closed',()=>{
  blocked(planBackupRetention(input([current()],{identity:{...identity,startedAt:new Date(now+1).toISOString()}})),'future_clock');
  blocked(planBackupRetention(input([current(),{state:'unknown',verifiedAt:new Date(now+1).toISOString()}])),'future_clock');
  const expired=receipt(10,now-35*60_000-1000,{historical:false,startedAt:new Date(now-40*60_000).toISOString()});
  blocked(planBackupRetention(input([expired],{identity:{...identity,startedAt:expired.startedAt},protectedPair:expired})),'protected_pair_unverified');
});
test('protected pair missing/changed, duplicate receipt or duplicate object identity never produces candidates',()=>{
  blocked(planBackupRetention(input([])),'protected_pair_missing_or_changed');
  blocked(planBackupRetention(input([{...current(),dumpEtag:'changed'}])),'protected_pair_missing_or_changed');
  blocked(planBackupRetention(input([current(),{state:'unknown',receiptId:current().receiptId}])),'inventory_conflict');
  blocked(planBackupRetention(input([current(),{...current(),receiptId:uuid(700)}])),'inventory_conflict');
  blocked(planBackupRetention(input([current(),{state:'unknown',dumpKey:current().dumpKey,localBytes:100,remoteBytes:100}])),'inventory_conflict');
});
test('bounded inventory is rejected before evaluating records beyond the explicit limit',()=>{
  let touched=false;const records=Array(513).fill(null);Object.defineProperty(records,512,{get(){touched=true;throw Error('must not inspect');}});
  blocked(planBackupRetention(input(records)),'inventory_limit');assert.equal(touched,false);
  blocked(planBackupRetention(input([current()],{inventoryLimit:MAX_RETENTION_INVENTORY+1})),'inventory_unverified');
});
test('quota is checked before any candidate removal and includes legacy baseline, held bytes and next pair',()=>{
  const records=[current(),...Array.from({length:110},(_,index)=>receipt(800+index,now-40*86_400_000-index*60_000)),
    {state:'unknown',localBytes:1000,remoteBytes:2000}];
  const request=input(records),base=planBackupRetention(request);
  assert(base.removalCandidates.local.length>0);assert(base.removalCandidates.remote.length>0);
  assert.equal(base.quota.current.localBytes,111*180+1000);assert.equal(base.quota.current.remoteBytes,111*180+2000+1234);
  assert.equal(base.quota.projectedBeforeAnyRemoval.requestCount,6);assert.equal(base.quota.projectedBeforeAnyRemoval.transferBytes,400);
  for(const change of [{maxLocalBytes:base.quota.current.localBytes},{maxRemoteBytes:base.quota.current.remoteBytes},
    {freeLocalBytes:1199},{maxRequestCount:5},{maxTransferBytes:399}]) {
    const result=planBackupRetention({...request,budgets:{...request.budgets,...change}});
    assert.equal(result.decision.writeAllowed,false);assert.equal(result.quota.decision,'exceeded');
  }
  const unknown=planBackupRetention({...request,budgets:{...request.budgets,remoteBaselineBytes:null}});
  assert.equal(unknown.decision.writeAllowed,false);assert.equal(unknown.quota.decision,'unverified');
});
test('numeric overflow fails closed and known-absent locations never become removal candidates',()=>{
  blocked(planBackupRetention(input([current(),{state:'unknown',localBytes:Number.MAX_SAFE_INTEGER,remoteBytes:0}])),'numeric_or_metadata_unverified');
  const absent=receipt(950,now-40*86_400_000,{localState:'absent',localBytes:0});
  const result=planBackupRetention(input([current(),absent]));assert(!ids(result.removalCandidates.local).has(absent.receiptId));
  assert(ids(result.retained.remote).has(absent.receiptId));
  blocked(planBackupRetention(input([current()],{now:Number.MAX_SAFE_INTEGER})),'identity_unverified');
});
