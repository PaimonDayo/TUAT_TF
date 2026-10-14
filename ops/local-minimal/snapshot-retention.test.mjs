import test from 'node:test';
import assert from 'node:assert/strict';
import {planSnapshotRetention} from './snapshot-retention.mjs';
const now=Date.parse('2026-10-14T02:00:00.000Z'),minute=60_000,day=86_400_000;
const identity={sourceId:'11111111-1111-4111-8111-111111111111',storageScopeId:'a'.repeat(64),archiveKeyId:'b'.repeat(64),
  databaseSystemIdentifier:'1234567890123456789',generation:'22222222-2222-4222-8222-222222222222',startedAt:new Date(now-30*minute).toISOString()};
const planNonce='33333333-3333-4333-8333-333333333333';
function snapshot(index,time=now-2000-index*15*minute) {
  const capturedAt=new Date(time).toISOString();
  return {version:1,state:'verified',storageScopeId:identity.storageScopeId,archiveKeyId:identity.archiveKeyId,objectEtag:`"test-${index}"`,
    localArchiveFile:`/var/lib/tuat-local/backup/snapshot-${index.toString(16).padStart(16,'0')}.tar.enc`,
    format:'tuat-local-db-images-v1',sourceId:identity.sourceId,generation:index===0?identity.generation:'44444444-4444-4444-8444-444444444444',
    databaseSystemIdentifier:identity.databaseSystemIdentifier,imageRoot:'/var/lib/tuat-local/images',
    archiveKey:`ops/pc-backend/${identity.sourceId}/backups/${capturedAt.replace(/[:.]/g,'-')}.local.tar.enc`,
    archiveSha256:index.toString(16).padStart(64,'0'),archiveBytes:17_674_276,capturedAt,
    restoreVerifiedAt:new Date(time+500).toISOString(),offsiteVerifiedAt:new Date(time+1000).toISOString(),independentRecoveryCopyChecked:true};
}
const input=snapshots=>({identity,snapshots,protectedSnapshot:snapshots[0],planNonce,now});
function denied(value,reason) {
  const result=planSnapshotRetention(value);assert.equal(result.planningAllowed,false);
  assert.equal(result.deletionAuthorized,false);assert.deepEqual(result.local.removalCandidates,[]);assert.deepEqual(result.remote.removalCandidates,[]);
  if(reason)assert.equal(result.reason,reason);
}

test('combined history selects bounded recent snapshots and daily anchors without authorizing deletion',()=>{
  const snapshots=Array.from({length:36*96},(_,i)=>snapshot(i));
  const result=planSnapshotRetention(input(snapshots));assert.equal(result.planningAllowed,true);
  assert.equal(result.dryRun,true);assert.equal(result.deletionAuthorized,false);
  assert(result.local.keep.length<=55&&result.remote.keep.length<=127);
  for(const [index,selection]of [[24,result.local],[96,result.remote]]){
    const keys=new Set(selection.keep.map(x=>x.archiveKey));
    snapshots.slice(0,index).forEach(r=>assert(keys.has(r.archiveKey)));
    assert(keys.has(snapshots[0].archiveKey));
    assert.equal(selection.keep.length+selection.removalCandidates.length,snapshots.length);
    const retainedDays=new Set(selection.keep.map(x=>new Date(Date.parse(x.capturedAt)+9*60*minute).toISOString().slice(0,10)));
    assert(retainedDays.size>=30);
  }
  assert(result.remote.removalCandidates.some(x=>x.archiveKey===snapshots.at(-1).archiveKey));
});

test('JST day boundaries preserve the newest old snapshot of each represented day',()=>{
  const snapshots=Array.from({length:120},(_,i)=>snapshot(i));
  const older=[snapshot(1001,Date.parse('2026-10-10T14:59:00.000Z')),snapshot(1002,Date.parse('2026-10-10T15:01:00.000Z')),snapshot(1003,Date.parse('2026-10-10T14:58:00.000Z'))];
  const result=planSnapshotRetention(input([...snapshots,...older]));assert(result.planningAllowed);
  for(const selection of [result.local,result.remote]){
    assert(selection.keep.some(x=>x.archiveKey===older[0].archiveKey));assert(selection.keep.some(x=>x.archiveKey===older[1].archiveKey));
    assert(selection.removalCandidates.some(x=>x.archiveKey===older[2].archiveKey));
  }
});

test('a protected snapshot outside the latest local set remains retained',()=>{
  const snapshots=Array.from({length:100},(_,i)=>snapshot(i,now-2000-i*1000));
  const protectedSnapshot={...snapshots[80],generation:identity.generation};snapshots[80]=protectedSnapshot;
  const result=planSnapshotRetention({...input(snapshots),protectedSnapshot});assert(result.planningAllowed);
  assert(result.local.keep.some(x=>x.archiveKey===protectedSnapshot.archiveKey));
  assert(!result.local.removalCandidates.some(x=>x.archiveKey===protectedSnapshot.archiveKey));
});

test('missing, stale, wrong-generation or modified current snapshots cannot support removal',()=>{
  const snapshots=[snapshot(0),snapshot(1)];
  denied({...input(snapshots),protectedSnapshot:{...snapshots[0],objectEtag:'"different"'}},'protected_snapshot_missing_or_changed');
  denied({...input(snapshots),protectedSnapshot:snapshots[1]},'protected_snapshot_unverified');
  const old=snapshot(0,now-35*minute);
  denied({...input([old]),identity:{...identity,startedAt:new Date(now-day).toISOString()}},'protected_snapshot_unverified');
  denied({...input(snapshots),snapshots:[snapshots[1]]},'protected_snapshot_missing_or_changed');
});

test('unknown, foreign, malformed and conflicting metadata never become candidates',()=>{
  const current=snapshot(0),old=snapshot(1,now-40*day);
  const mutations=[{state:'unknown'},{storageScopeId:'b'.repeat(64)},{archiveKeyId:'c'.repeat(64)},{sourceId:'55555555-5555-4555-8555-555555555555'},
    {databaseSystemIdentifier:'9999999999999999999'},{independentRecoveryCopyChecked:false},
    {archiveKey:old.archiveKey.replace(identity.sourceId,'55555555-5555-4555-8555-555555555555')},
    {localArchiveFile:'/var/lib/tuat-local/backup/../private/runtime-backup.key'},{objectEtag:'bad\nheader'},
    {archiveBytes:Number.MAX_SAFE_INTEGER+1},{archiveSha256:'bad'},{extra:'unknown'},
    {restoreVerifiedAt:new Date(Date.parse(old.capturedAt)-1).toISOString()},{offsiteVerifiedAt:new Date(now+1).toISOString()}];
  for(const mutation of mutations)denied(input([current,{...old,...mutation}]),'receipt_unverified');
  denied(input([current,current]),'duplicate_identity');
  denied(input([current,{...old,localArchiveFile:current.localArchiveFile}]),'duplicate_identity');
});

test('metadata accessors are refused without being evaluated',()=>{
  const current=snapshot(0),old=snapshot(1);let accessed=false;
  Object.defineProperty(old,'archiveSha256',{enumerable:true,get(){accessed=true;throw Error('must not evaluate');}});
  denied(input([current,old]),'receipt_unverified');assert.equal(accessed,false);
  const list=[current];Object.defineProperty(list,1,{enumerable:true,get(){accessed=true;throw Error('must not evaluate');}});
  denied(input(list),'receipt_unverified');assert.equal(accessed,false);
});

test('the plan binds exact content, scope, time and nonce but not input order',()=>{
  const snapshots=[snapshot(0),snapshot(1),snapshot(2)],original=planSnapshotRetention(input(snapshots));
  const reordered=planSnapshotRetention({...input([...snapshots].reverse()),protectedSnapshot:snapshots[0]});assert.equal(original.planDigest,reordered.planDigest);
  const modified=[snapshots[0],{...snapshots[1],objectEtag:'"new"'},snapshots[2]];
  assert.notEqual(original.planDigest,planSnapshotRetention(input(modified)).planDigest);
  assert.notEqual(original.planDigest,planSnapshotRetention({...input(snapshots),planNonce:'55555555-5555-4555-8555-555555555555'}).planDigest);
  assert.notEqual(original.planDigest,planSnapshotRetention({...input(snapshots),now:now+1}).planDigest);
});

test('incomplete or oversized inventories fail closed',()=>{
  denied(input([]),'inventory_unverified');denied(input(Array(4097).fill(snapshot(0))),'inventory_unverified');
  denied({...input([snapshot(0)]),identity:{...identity,startedAt:new Date(now+1).toISOString()}},'identity_unverified');
});
