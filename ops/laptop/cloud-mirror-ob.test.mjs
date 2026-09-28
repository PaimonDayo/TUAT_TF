import test from 'node:test';
import assert from 'node:assert/strict';
import { OB_TABLES, changesPath } from './cloud-mirror-ob.mjs';
test('OB mirror covers all six tables with their production primary keys', () => {
  assert.equal(OB_TABLES.length, 6);
  assert.deepEqual(OB_TABLES.find(t => t.table === 'ob_meet_duties').pk, ['meet_key','profile_id','slot_time','event_name']);
  const position = name => OB_TABLES.findIndex(t => t.table === name);
  for (const [parent,child] of [['ob_duty_event_slots','ob_duty_roles'],['ob_duty_event_slots','ob_meet_duties'],['ob_meet_entries','ob_party_responses'],['ob_meet_entries','ob_entry_changes']]) {
    assert(position(parent) < position(child));
  }
});
test('exhausted retries are excluded from replay but never from overwrite protection', () => {
  const replay = new URL(changesPath(1000,1000,5), 'https://example.test');
  const held = new URL(changesPath(1000,1000,5,true), 'https://example.test');
  assert.equal(replay.searchParams.get('attempts'), 'lt.5');
  assert.equal(held.searchParams.has('attempts'), false);
  assert.equal(held.searchParams.get('offset'), '1000');
});

import { orderObReplay, obReplayHeaders } from './cloud-mirror-ob.mjs';
test('replays original audit rows after parents and suppresses only matching regenerated logs', () => {
  const entry={id:2,table_name:'ob_meet_entries',op:'UPDATE',pk:{id:'e'},row_data:{revision:3}};
  const audit={id:1,table_name:'ob_entry_changes',op:'INSERT',row_data:{after_data:{id:'e',revision:3}}};
  const other={id:3,table_name:'profiles'};
  assert.deepEqual(orderObReplay([audit,entry,other]),[entry,other,audit]);
  assert.deepEqual(obReplayHeaders(entry,[audit,entry]),{'x-tuat-mirror':'1'});
  assert.deepEqual(obReplayHeaders(entry,[]),{});
  assert.deepEqual(obReplayHeaders({...entry,row_data:{revision:4}},[audit]),{});
  assert.deepEqual(obReplayHeaders({...entry,table_name:'ob_party_responses'},[audit]),{});
  const party={...audit,row_data:{after_data:{id:'e',revision:3,change_type:'party'}}};
  assert.deepEqual(obReplayHeaders({...entry,table_name:'ob_party_responses'},[party]),{'x-tuat-mirror':'1'});
});
