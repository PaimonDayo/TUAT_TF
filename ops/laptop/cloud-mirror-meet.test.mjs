import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEET_TABLES, meetMirrorRows, meetReplayConfirmed, meetReplayUnits, replayMeetChanges } from './cloud-mirror-meet.mjs';
test('parents precede appearances, duties and immutable requests', () => {
  const rank = name => MEET_TABLES.findIndex(spec => spec.table === name);
  for (const child of ['competition_appearances','competition_meet_duties','competition_meet_party']) assert(rank('competition_participants') < rank(child));
  assert(rank('competition_meet_requests') > rank('competition_appearances'));
});
test('an absence and its placement changes replay together; other competitions remain independent', () => {
  const rows = [{id:1,table_name:'competition_participants',row_data:{competition_id:'one'}},{id:2,table_name:'competition_appearances',row_data:{competition_id:'one'}},{id:3,table_name:'competition_appearances',row_data:{competition_id:'two'}},{id:4,table_name:'profiles'}];
  const grouped = meetReplayUnits(rows);
  assert.deepEqual(grouped.units.map(unit=>unit.map(row=>row.id)),[[1,2],[3]]);assert.deepEqual(grouped.rest,[rows[3]]);
});
test('uncertain replay never acknowledges success and protects the whole competition', async () => {
  const rows=[{id:1,attempts:0,table_name:'competition_participants',row_data:{competition_id:'one'}},{id:2,attempts:0,table_name:'competition_appearances',row_data:{competition_id:'one'}}];
  const acknowledged=[];
  const result=await replayMeetChanges(rows,{maxAttempts:5,applyBatch:async()=>{throw Error('offline');},acknowledge:async (unit,outcome)=>acknowledged.push([unit.map(row=>row.id),outcome])});
  assert.equal(result.applied,0);assert.equal(result.failed,2);assert.deepEqual(acknowledged,[[[1,2],'Meet replay could not be confirmed']]);
});
test('mirrors composite keys and full source rows atomically without touching unrelated tables',()=>{
 const row={competition_id:'one',name:'男子100m',confirmed:false,revision:2};
 const rows=meetMirrorRows([{spec:MEET_TABLES[1],deletes:[{competition_id:'one',name:'女子100m'}],upserts:[row]},{spec:{table:'profiles',pk:['id']},deletes:[],upserts:[{id:'private account'}]}]);
 assert.deepEqual(rows,[{id:1,table_name:'competition_meet_events',op:'DELETE',pk:{competition_id:'one',name:'女子100m'}},{id:2,table_name:'competition_meet_events',op:'UPDATE',pk:{competition_id:'one',name:'男子100m'},row_data:row,changed:['confirmed','revision']}]);
});
test('a successful HTTP response without the exact row count is never acknowledged',()=>{
 assert.equal(meetReplayConfirmed({ok:true,text:'{"count":2}'},2),true);
 for(const text of ['null','{"count":1}','invalid'])assert.equal(meetReplayConfirmed({ok:true,text},2),'Meet replay count could not be confirmed');
 assert.equal(meetReplayConfirmed({ok:false,status:503,text:'private details'},2),'503 Meet replay failed');
});
