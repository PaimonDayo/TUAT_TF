import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSnapshot,dryRun,applyCleanup,GRACE_MS } from './cleanup.mjs';
import { run,createAdapter } from './run.mjs';

const now=Date.parse('2026-10-11T00:00:00Z');
const iso=milliseconds=>new Date(milliseconds).toISOString();
const config={version:1,enabled:false,sourceId:'synthetic-image-review',pcUrl:'http://127.0.0.1:18180',
  database:'tuat_rls_review',systemIdentifier:'1234567890123456789',r2AccountId:'a'.repeat(32),r2Bucket:'synthetic-images',requestTimeoutMs:330000};
function fixture({open=false}={}) {
  const row={bucket:'avatars',path:'synthetic-member/retired.webp',confirmed_at:iso(now-GRACE_MS-3000),
    closed_at:open?null:iso(now-GRACE_MS-2000),delete_after:open?null:iso(now-2000),deleted_at:null};
  const calls=[];
  const target={database:config.database,system_identifier:config.systemIdentifier,schema_version:'20261011150000',server_utc:iso(now)};
  const adapter={
    target:async()=>{calls.push('target');return {...target};},
    confirmed:async(limit)=>{assert.equal(limit,100);calls.push('confirmed');return [{...row}];},
    claim:async(bucket,path)=>{calls.push('claim');assert.equal(bucket,row.bucket);assert.equal(path,row.path);
      if(row.closed_at===null) { row.closed_at=iso(now);row.delete_after=iso(now+GRACE_MS); }
      return {...row,server_utc:iso(now)};},
    remove:async key=>{calls.push(['remove',key]);},
    finish:async()=>{calls.push('finish');return true;},
  };
  return {row,target,adapter,calls};
}
test('default check has no configuration, provider or mutation reads',async()=>{
  assert.deepEqual(await run(),{enabled:false,reads:false,writes:false});
});
test('dry run captures only bounded confirmed rows and never claims/deletes',async()=>{
  const f=fixture(); const preview=dryRun(await captureSnapshot(config,f.adapter,now));
  assert.deepEqual(preview.counts,{confirmed:1,awaitingClosure:0});
  assert.deepEqual(f.calls,['target','confirmed','target']);
  await assert.rejects(applyCleanup(config,f.adapter,preview,{now:()=>now}),/disabled/);
  assert.deepEqual(f.calls,['target','confirmed','target']);
});
test('explicit apply requires unchanged correct-target snapshot and dry run',async()=>{
  const f=fixture();const preview=dryRun(await captureSnapshot(config,f.adapter,now));
  await assert.rejects(applyCleanup({...config,enabled:true},f.adapter,null,{now:()=>now}),/snapshot/);
  f.target.system_identifier='9876543210123456789';
  await assert.rejects(applyCleanup({...config,enabled:true},f.adapter,preview,{now:()=>now}),/target mismatch/);
  f.target.system_identifier=config.systemIdentifier;f.row.path='synthetic-member/changed.webp';
  await assert.rejects(applyCleanup({...config,enabled:true},f.adapter,preview,{now:()=>now}),/changed since dry run/);
  assert.ok(!f.calls.some(call=>Array.isArray(call)));
});
test('new closure retains object for seven days plus GET/clock margin',async()=>{
  const f=fixture({open:true});const preview=dryRun(await captureSnapshot(config,f.adapter,now));
  assert.deepEqual(await applyCleanup({...config,enabled:true},f.adapter,preview,{now:()=>now}),{confirmed:1,closed:1,deleted:0,retained:1});
  assert.equal(Date.parse(f.row.delete_after)-Date.parse(f.row.closed_at),GRACE_MS);
  assert.ok(!f.calls.includes('finish'));assert.ok(!f.calls.some(call=>Array.isArray(call)));
});
test('only a due closed path reaches its exact R2 bucket prefix and acknowledgement',async()=>{
  const f=fixture();const preview=dryRun(await captureSnapshot(config,f.adapter,now));
  assert.deepEqual(await applyCleanup({...config,enabled:true},f.adapter,preview,{now:()=>now}),{confirmed:1,closed:0,deleted:1,retained:0});
  assert.deepEqual(f.calls.slice(-4),['claim','target',['remove','avatars/synthetic-member/retired.webp'],'finish']);
});
test('a concurrently referenced or unknown claim retains the object',async()=>{
  const f=fixture();const preview=dryRun(await captureSnapshot(config,f.adapter,now));
  f.adapter.claim=async()=>null;
  assert.equal((await applyCleanup({...config,enabled:true},f.adapter,preview,{now:()=>now})).retained,1);
  assert.ok(!f.calls.some(call=>Array.isArray(call)));
});
test('UTC skew or database time before grace blocks physical DELETE',async()=>{
  for(const skew of [121000,-121000]) {
    const f=fixture();const preview=dryRun(await captureSnapshot(config,f.adapter,now));
    f.target.server_utc=iso(now+skew);
    await assert.rejects(applyCleanup({...config,enabled:true},f.adapter,preview,{now:()=>now}),/clock/);
    assert.ok(!f.calls.some(call=>Array.isArray(call)));
  }
  const f=fixture();const preview=dryRun(await captureSnapshot(config,f.adapter,now));
  f.adapter.claim=async()=>({...f.row,server_utc:iso(now-3000)});
  assert.equal((await applyCleanup({...config,enabled:true},f.adapter,preview,{now:()=>now})).retained,1);
  assert.ok(!f.calls.some(call=>Array.isArray(call)));
});
test('unknown physical DELETE stops without acknowledging or dispatching another path',async()=>{
  const f=fixture();const preview=dryRun(await captureSnapshot(config,f.adapter,now));
  f.adapter.remove=async()=>{throw Error('synthetic lost provider response');};
  await assert.rejects(applyCleanup({...config,enabled:true},f.adapter,preview,{now:()=>now}),/lost provider/);
  assert.ok(!f.calls.includes('finish'));
});
test('DB claim/ack failures preserve the terminal retirement and never replay a save',async()=>{
  for(const stage of ['claim','finish']) {
    const f=fixture();const preview=dryRun(await captureSnapshot(config,f.adapter,now));
    f.adapter[stage]=async()=>{throw Error('synthetic DB response lost');};
    await assert.rejects(applyCleanup({...config,enabled:true},f.adapter,preview,{now:()=>now}),/response lost/);
    assert.notEqual(f.row.closed_at,null);assert.equal(f.row.deleted_at,null);
  }
});
test('legacy/unknown/malformed rows fail closed before any claim or object dispatch',async()=>{
  for(const changes of [{confirmed_at:null},{path:'../other.webp'},{bucket:'tweet-images'},
    {delete_after:iso(now-GRACE_MS)}, {deleted_at:iso(now)}]) {
    const f=fixture();Object.assign(f.row,changes);
    await assert.rejects(captureSnapshot(config,f.adapter,now),/Invalid confirmed/);
    assert.ok(!f.calls.includes('claim'));
  }
});
test('adapter pins loopback REST, rejects redirects and never lists legacy queue or inventory',async()=>{
  const urls=[];const env={PC_IMAGE_CLEANUP_SERVICE_ROLE_KEY:'synthetic-only',PC_IMAGE_CLEANUP_R2_ACCESS_KEY_ID:'synthetic-only',
    PC_IMAGE_CLEANUP_R2_SECRET_ACCESS_KEY:'synthetic-only',PC_IMAGE_CLEANUP_R2_ACCOUNT_ID:config.r2AccountId,PC_IMAGE_CLEANUP_R2_BUCKET:config.r2Bucket};
  const adapter=createAdapter(config,env,{fetchRequest:async(url,options)=>{urls.push(url);assert.equal(options.redirect,'error');
    return new Response('[]',{status:200});},removeObject:async()=>{throw Error('unexpected delete');}});
  await adapter.confirmed(100,iso(now));
  assert.ok(urls[0].startsWith(config.pcUrl+'/rest/v1/confirmed_image_retirements?'));
  assert.ok(urls[0].includes('closed_at.is.null'));assert.ok(!urls[0].includes('note_image_cleanup'));
  assert.throws(()=>createAdapter(config,{...env,PC_IMAGE_CLEANUP_R2_BUCKET:'other-bucket'}),/target mismatch/);
});
