import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { canonical,parseLosslessJson,groupChanges,finalExpectation,classify,createReadOnlyReader,captureReadOnly } from './reconcile.mjs';
import { prepareEncryptedPair,verifyEncryptedPair } from './snapshot.mjs';

function definition(pk,columns) {
  return {properties:Object.fromEntries(columns.map(name=>[name,{type:'string',format:'text',...(pk.includes(name)?{description:'This is a Primary Key.<pk/>'}:{})}]))};
}
const definitions={
  failover_changes:definition(['id'],['id','table_name','op','pk','row_data','changed','created_at','attempts','last_error']),
  profiles:definition(['id'],['id','name','count']),
  practice_records:definition(['id'],['id','user_id','recorded_date','count']),
  push_subscriptions:definition(['id'],['id','user_id','endpoint','p256dh','auth','created_at','last_seen_at']),
  ob_event_operations:definition(['meet_key','event_name'],['meet_key','event_name','revision','updated_at','data']),
};
const docs={cloud:{definitions},pc:{definitions}};
const change=(id,extra={})=>({id,table_name:'profiles',op:'UPDATE',pk:{id:'p'},row_data:{id:'p',name:'A',count:1},
  changed:['name'],created_at:'2026-10-11T00:00:00Z',attempts:5,last_error:'synthetic held failure',...extra});
function outcome(changes,evidence,schemas=docs) {
  const group=groupChanges(changes)[0]; return classify(group,finalExpectation(group,schemas),evidence);
}

test('queued push subscriptions compare by UUID and preserve endpoint replacement and missing-delete uncertainty',()=>{
  const row={id:'subscription-a',user_id:'user-a',endpoint:'https://push.example.invalid/subscription-a',p256dh:'synthetic-public-key',auth:'synthetic-auth',created_at:'2026-10-01T00:00:00Z',last_seen_at:'2026-10-11T00:00:00Z'};
  const queued=change(1,{table_name:'push_subscriptions',pk:{id:row.id},row_data:row,changed:['last_seen_at']});
  const matched=outcome([queued],{kind:'rows',rows:[row]});
  assert.equal(matched.classification,'pc_matches_final_change');assert.equal(matched.acknowledgementAllowed,false);assert.equal(matched.retryHeld,true);
  const alternative=outcome([queued],{kind:'rows',rows:[],natural:{kind:'rows',rows:[{...row,id:'replacement-subscription'}]}});
  assert.equal(alternative.classification,'divergence');assert.equal(alternative.reason,'natural_key_alternative_requires_review');
  const deleted=outcome([change(2,{table_name:'push_subscriptions',pk:{id:row.id},op:'DELETE',row_data:null,changed:null})],{kind:'rows',rows:[]});
  assert.equal(deleted.classification,'unknown');assert.equal(deleted.reason,'natural_key_identity_unproved');
});

test('composes queued updates in ID order and compares only queued final fields',()=>{
  const result=outcome([change(2,{row_data:{id:'p',name:'A',count:2},changed:['count']}),change(1)],
    {kind:'rows',rows:[{id:'p',name:'A',count:2,unrelated:'current PC value'}]});
  assert.equal(result.classification,'pc_matches_final_change');
  assert.equal(result.retryHeld,true);
  assert.equal(result.effectsVerified,false);
  assert.equal(result.acknowledgementAllowed,false);
  assert.equal(outcome([change(1)],{kind:'rows',rows:[{id:'p',name:'different'}]}).classification,'divergence');
});

test('INSERT/DELETE ordering reflects the final state without inferring a replay happened',()=>{
  const insert=change(1,{op:'INSERT',changed:null});
  const remove=change(2,{op:'DELETE',row_data:null,changed:null});
  assert.equal(outcome([insert,remove],{kind:'rows',rows:[]}).classification,'pc_matches_final_change');
  assert.equal(outcome([insert,remove],{kind:'rows',rows:[{id:'p'}]}).classification,'divergence');
  assert.equal(outcome([remove,change(3)],{kind:'rows',rows:[]}).classification,'unknown');
  assert.equal(outcome([remove,change(3,{op:'INSERT',changed:null})],{kind:'rows',rows:[{id:'p',name:'A',count:1}]}).classification,'pc_matches_final_change');
});

test('confirmed empty result, JSON null, read error and null change payload stay distinct',()=>{
  assert.equal(outcome([change(1)],{kind:'rows',rows:[]}).classification,'divergence');
  for(const evidence of [{kind:'rows',rows:null},{kind:'invalid',rows:null},{kind:'read_error'}]) {
    assert.equal(outcome([change(1)],evidence).classification,'unknown');
  }
  assert.equal(outcome([change(1,{row_data:null})],{kind:'rows',rows:[]}).classification,'unknown');
  assert.equal(outcome([change(1,{row_data:{id:'p',name:null,count:1}})],{kind:'rows',rows:[{id:'p',name:null}]}).classification,'pc_matches_final_change');
});

test('schema mismatch, primary-key changes, duplicate/mismatched target rows fail closed',()=>{
  const mismatched={...docs,pc:{definitions:{...definitions,profiles:definition(['name'],['id','name','count'])}}};
  assert.equal(outcome([change(1)],{kind:'rows',rows:[{id:'p',name:'A'}]},mismatched).classification,'schema_mismatch');
  assert.equal(outcome([change(1,{changed:['id']})],{kind:'rows',rows:[{id:'p'}]}).classification,'unknown');
  assert.equal(outcome([change(1)],{kind:'schema_error'}).classification,'schema_mismatch');
  for(const rows of [[{id:'p'},{id:'p'}],[{id:'other',name:'A'}]]) assert.equal(outcome([change(1)],{kind:'rows',rows}).classification,'unknown');
});

test('natural-key alternatives require identity review; delete without a known natural key is unknown',()=>{
  const record=change(1,{table_name:'practice_records',row_data:{id:'p',user_id:'u',recorded_date:'2026-10-11',count:1},changed:['count']});
  assert.equal(outcome([record],{kind:'rows',rows:[],natural:{kind:'rows',rows:[{id:'other'}]}}).classification,'divergence');
  assert.equal(outcome([record],{kind:'rows',rows:[],natural:{kind:'read_error'}}).classification,'unknown');
  const remove={...record,id:2,op:'DELETE',row_data:null,changed:null};
  assert.equal(outcome([remove],{kind:'rows',rows:[]}).classification,'unknown');
  assert.equal(outcome([record,remove],{kind:'rows',rows:[],natural:{kind:'rows',rows:[]}}).classification,'pc_matches_final_change');
});

test('lossless numeric comparison does not collapse bigint/decimal differences',()=>{
  const parsed=parseLosslessJson('{"a":9007199254740992,"b":9007199254740993,"c":0.123456789012345678901,"d":0.123456789012345678902}');
  assert.notEqual(canonical(parsed.a),canonical(parsed.b));
  assert.notEqual(canonical(parsed.c),canonical(parsed.d));
  assert.equal(canonical(parseLosslessJson('1.00')),canonical(parseLosslessJson('1e0')));
  assert.throws(()=>canonical(9007199254740993),/Lossless/);
});

const proof={cloudOrigin:'https://cloud.example.test',pcOrigin:'https://pc.example.test',cloudSettingsHash:'a'.repeat(64),pcSettingsHash:'b'.repeat(64),
  pcInstanceId:'synthetic-instance',pcRuntimeProofHash:'c'.repeat(64),authoritativeSettingsVerified:true,pcRuntimeOwnershipVerified:true};
function fakeReader({queue=[change(1)],targetRows=[{id:'p',name:'A',count:1}],queueDrift=false,targetFailure=false,targetDrift=false,targetHandler,queueIncomplete=false,maxRequests,maxBytes}={}) {
  const calls=[];let heads=0,targetReads=0;
  const reader=createReadOnlyReader({cloud:{url:proof.cloudOrigin,key:'synthetic-cloud'},pc:{url:proof.pcOrigin,key:'synthetic-pc'},expected:proof,synthetic:true,maxRequests,maxBytes,
    fetchImpl:async(url,init)=>{
      calls.push({url,method:init.method,redirect:init.redirect});
      const path=new URL(url);
      if(path.pathname==='/rest/v1/')return Response.json({definitions});
      if(path.hostname==='cloud.example.test'){
        if(path.searchParams.get('select')==='id'){
          heads++;return Response.json(queue.length?[{id:queue.at(-1).id}]:[],{headers:{'content-range':queue.length?`0-0/${queue.length}`:'*/0'}});
        }
        const filter=path.searchParams.get('and');
        const cursor=Number(filter.match(/id\.gt\.(\d+)/)[1]),ceiling=Number(filter.match(/id\.lte\.(\d+)/)[1]);
        const selected=queue.filter(row=>row.id>cursor&&row.id<=ceiling).slice(0,Number(path.searchParams.get('limit')));
        return Response.json(queueIncomplete?selected.slice(1):queueDrift&&heads>1?selected.map(row=>({...row,row_data:{...row.row_data,name:'changed'}})):selected);
      }
      targetReads++;
      if(targetHandler)return targetHandler(path,targetReads);
      if(targetFailure)return Response.json({error:'synthetic private detail'},{status:503});
      return Response.json(targetDrift&&targetReads>1?targetRows.map(row=>({...row,name:'changed'})):targetRows);
    }});
  return {reader,calls};
}

test('bounded keyset capture includes retry-held rows and produces only a nonretirement dry-run',async()=>{
  const {reader,calls}=fakeReader({queue:Array.from({length:5},(_,i)=>change(i+1))});
  const result=await captureReadOnly(reader,{pageSize:2,maxRows:10});
  assert.equal(result.snapshot.changes.length,5);
  assert.equal(result.report.counts.pc_matches_final_change,1);
  assert.equal(result.report.queuedChanges,5);
  assert.equal(result.report.retirementReady,false);
  assert.equal(result.report.triggerAndJournalEffectsVerified,false);
  assert.equal(result.report.queueStable,true);
  assert(calls.every(call=>call.method==='GET'&&call.redirect==='error'));
  assert(calls.filter(call=>call.url.includes('failover_changes')).every(call=>!call.url.includes('attempts=lt')));
  assert(calls.some(call=>call.url.includes('id.gt.2')));
  assert(result.snapshot.responses.every(row=>!JSON.stringify(row).includes('synthetic-cloud')));
});

test('PC read errors and concurrent queue/target changes become unknown, never missing or ready',async()=>{
  for(const options of [{targetFailure:true},{queueDrift:true},{targetDrift:true}]){
    const {reader}=fakeReader(options),result=await captureReadOnly(reader);
    assert.equal(result.report.counts.unknown,1);
    assert.equal(result.report.counts.pc_matches_final_change,0);
    assert.equal(result.report.retirementReady,false);
  }
});

test('read scope/budgets and missing ownership proof fail before unsafe dispatch',async()=>{
  const {reader,calls}=fakeReader();
  for(const path of ['/rest/v1/rpc/replay_ob_family_operations','/auth/v1/admin/users','/rest/v1/google_drive_connections',
    '/rest/v1/profiles?select=*&limit=2',
    '/rest/v1/profiles?select=*,roles(*)&limit=2&id=eq.%22p%22',
    '/rest/v1/profiles?select=*&limit=2&id=eq.p',
    '/rest/v1/profiles?select=*&limit=2&id=eq.%22p%22&id=eq.%22other%22',
    '/rest/v1/profiles?select=*&limit=2&id=eq.%22p%22&or=(id.eq.other)',
    '/rest/v1/profiles?select=*&limit=2&id=eq.%22p%22,other.eq.anything',
    '/rest/v1/profiles?select=*&limit=2&id=eq.%22unterminated',
    '/rest/v1/profiles?select=*&limit=2&id=eq.%22bad%5Cq%22',
    '/rest/v1/profiles?select=*&limit=3&id=eq.%22p%22',
    '/rest/v1/profiles?select=*&limit=2&id=eq.%22p%22#private',
    '/rest/v1/profiles/../failover_changes',
    '/rest/v1/%2e%2e/auth/v1/admin/users',
    '//cloud.example.test/rest/v1/failover_changes',
    '/rest/v1/\\cloud.example.test',
    '/rest/v1/profiles?select=*&limit=2&id=eq.%22p%22&offset=1']){
    await assert.rejects(reader.read('pc',path),/read_scope/);
  }
  for(const path of ['/rest/v1/profiles?select=id&order=id.desc&limit=1',
    '/rest/v1/failover_changes?select=id&order=id.desc&limit=1&attempts=lt.5',
    '/rest/v1/failover_changes?select=*&order=id.asc&limit=50',
    '/rest/v1/?select=*']) await assert.rejects(reader.read('cloud',path,{count:true}),/read_scope/);
  assert.equal(calls.length,0);
  assert.throws(()=>createReadOnlyReader({cloud:{url:proof.cloudOrigin,key:'synthetic'},pc:{url:proof.pcOrigin,key:'synthetic'},expected:{...proof,pcRuntimeOwnershipVerified:false}}),/target\/runtime proof/);
  assert.throws(()=>createReadOnlyReader({cloud:{url:proof.cloudOrigin,key:'synthetic'},pc:{url:proof.pcOrigin,key:'synthetic'},expected:proof,synthetic:true}),/Synthetic injected/);
});

test('PK and natural-key filters escape PostgREST grammar and keep one scalar per key',async()=>{
  const key='comma,(parentheses).colon:"quote"\\slash&or=(id.eq.other)';
  const quoted=`eq."${key.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;
  const primary=fakeReader({queue:[change(1,{pk:{id:key},row_data:{id:key,name:'A',count:1}})],
    targetHandler:url=>{assert.equal(url.searchParams.get('id'),quoted);assert.deepEqual([...url.searchParams.keys()],['select','limit','id']);
      return Response.json([{id:key,name:'A',count:1}]);}});
  assert.equal((await captureReadOnly(primary.reader)).report.counts.pc_matches_final_change,1);
  const natural=fakeReader({queue:[change(1,{table_name:'practice_records',row_data:{id:'p',user_id:key,recorded_date:'2026-10-11',count:1},changed:['count']})],
    targetHandler:url=>{if(url.searchParams.has('user_id')){
      assert.equal(url.searchParams.get('user_id'),quoted);
      assert.equal(url.searchParams.get('recorded_date'),'eq."2026-10-11"');
      assert.deepEqual([...url.searchParams.keys()],['select','limit','user_id','recorded_date']);
    } return Response.json([]);}});
  assert.equal((await captureReadOnly(natural.reader)).report.counts.divergence,1);
  assert(primary.calls.every(call=>new URL(call.url).origin===proof.cloudOrigin||new URL(call.url).origin===proof.pcOrigin));
});

test('queue incompleteness and request/byte budgets abort without extra dispatch or retry',async()=>{
  const incomplete=fakeReader({queue:[change(1),change(2)],queueIncomplete:true});
  await assert.rejects(captureReadOnly(incomplete.reader),/queue_incomplete/);
  assert.equal(incomplete.calls.filter(call=>new URL(call.url).searchParams.has('and')).length,1);
  const bounded=fakeReader({maxRequests:1});
  await bounded.reader.read('cloud','/rest/v1/');
  await assert.rejects(bounded.reader.read('pc','/rest/v1/'),/read_scope_or_budget/);
  assert.equal(bounded.calls.length,1);
  const bytes=fakeReader({maxBytes:4});
  await assert.rejects(bytes.reader.read('cloud','/rest/v1/'),/read_bytes_exceeded/);
  assert.equal(bytes.calls.length,1);
});

test('OB operation capture includes the held sibling and marks sibling read failure unknown',async()=>{
  const row={meet_key:'ob-2026',event_name:'男子100m',revision:2,updated_at:'2026-10-11T00:00:00Z',data:{stage:'synthetic'}};
  for(const failed of [false,true]){
    const {reader,calls}=fakeReader({queue:[change(1,{table_name:'ob_event_operations',pk:{meet_key:row.meet_key,event_name:row.event_name},row_data:row,changed:['data']})],
      targetHandler:url=>{
        const event=url.searchParams.get('event_name');
        assert.equal(url.searchParams.get('meet_key'),'eq."ob-2026"');
        if(event==='eq."女子100m"')return failed?Response.json({error:'private sibling failure'},{status:503}):Response.json([{...row,event_name:'女子100m'}]);
        assert.equal(event,'eq."男子100m"');return Response.json([row]);
      }});
    const result=await captureReadOnly(reader);
    assert.equal(result.snapshot.targets.length,2);
    assert.equal(calls.filter(call=>new URL(call.url).pathname==='/rest/v1/ob_event_operations').length,4);
    assert.equal(result.report.counts[failed?'unknown':'pc_matches_final_change'],1);
    assert.equal(result.report.classifications[0].retryHeld,true);
    assert.equal(result.report.triggerAndJournalEffectsVerified,false);
  }
});

test('encrypted snapshot/report pair authenticates readback, never contains plaintext rows or accepts tampering/mixed captures',async()=>{
  const {reader}=fakeReader(),result=await captureReadOnly(reader),key=randomBytes(32);
  const pair=prepareEncryptedPair(result,key);
  assert(!pair.snapshotBytes.includes(Buffer.from('synthetic held failure')));
  assert(!pair.reportBytes.includes(Buffer.from('pc_matches_final_change')));
  const verified=verifyEncryptedPair(pair.snapshotBytes,pair.reportBytes,key);
  assert.equal(verified.captureId,pair.captureId);
  assert.equal(verified.report.counts.pc_matches_final_change,1);
  const altered=Buffer.from(pair.snapshotBytes);altered[altered.length-1]^=1;
  assert.throws(()=>verifyEncryptedPair(altered,pair.reportBytes,key));
  const second=prepareEncryptedPair(result,key);
  assert.throws(()=>verifyEncryptedPair(pair.snapshotBytes,second.reportBytes,key),/pair binding/);
  assert.throws(()=>verifyEncryptedPair(pair.snapshotBytes,pair.reportBytes,randomBytes(32)));
  assert.throws(()=>prepareEncryptedPair({...result,report:{...result.report,retirementReady:true}},key),/remain held/);
});
