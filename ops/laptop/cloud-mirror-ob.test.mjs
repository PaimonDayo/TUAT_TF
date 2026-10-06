import test from 'node:test';
import assert from 'node:assert/strict';
import { OB_TABLES, changesPath, obOperationReplayUnits, obReplayProtection, replayObChanges } from './cloud-mirror-ob.mjs';
test('OB mirror covers all nine tables with their production primary keys', () => {
  assert.equal(OB_TABLES.length, 9);
  assert.deepEqual(OB_TABLES.find(t => t.table === 'ob_entry_duties').pk, ['meet_key','entry_id','slot_time','event_name']);
  assert.deepEqual(OB_TABLES.find(t => t.table === 'ob_event_operations').pk, ['meet_key','event_name']);
  assert.deepEqual(OB_TABLES.find(t => t.table === 'ob_meet_duties').pk, ['meet_key','profile_id','slot_time','event_name']);
  const position = name => OB_TABLES.findIndex(t => t.table === name);
  for (const [parent,child] of [['ob_duty_event_slots','ob_duty_roles'],['ob_duty_event_slots','ob_meet_duties'],['ob_meet_entries','ob_entry_duties'],['ob_meet_entries','ob_party_responses'],['ob_meet_entries','ob_entry_changes']]) {
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
test('replays queued audit inserts before deleting their registration', () => {
  const create={id:2,table_name:'ob_meet_entries',op:'INSERT',pk:{id:'e'}};
  const audit={id:1,table_name:'ob_entry_changes',op:'INSERT',row_data:{entry_id:'e',after_data:{id:'e'}}};
  const detach={id:3,table_name:'ob_entry_changes',op:'UPDATE',row_data:{entry_id:null,after_data:{id:'e'}}};
  const remove={id:4,table_name:'ob_meet_entries',op:'DELETE',pk:{id:'e'}};
  const recreate={id:5,table_name:'ob_meet_entries',op:'INSERT',pk:{id:'new'}};
  assert.deepEqual(orderObReplay([audit,create,detach,remove,recreate]),[create,audit,detach,remove,recreate]);
});
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

const operation = (id, event, time = '2026-10-06T00:00:00.123456Z', attempts = 0, op = 'UPDATE') => ({
  id, attempts, table_name: 'ob_event_operations', op, pk: { meet_key: 'ob-2026', event_name: event },
  row_data: { meet_key: 'ob-2026', event_name: event, revision: 4, data: { participants: [], confirmed: false }, updated_at: time }, changed: ['revision', 'data', 'updated_at'],
});

test('pairs source operations by family and exact transaction timestamp while preserving other replay order', () => {
  const a = operation(1, '男子100m'), audit = { id: 2, attempts: 0, table_name: 'ob_operation_changes', op: 'INSERT', pk: { id: 'audit' } }, b = operation(3, '女子100m', undefined, 0, 'INSERT');
  const old = operation(4, '女子100m', '2026-10-06T00:00:00.123455Z'), another = operation(5, '男子300m');
  const units = obOperationReplayUnits([a, audit, b, old, another]);
  assert.deepEqual(units.map(unit => unit.changes.map(change => change.id)), [[1, 3], [2], [4], [5]]);
  assert.deepEqual(units.map(unit => unit.operations), [true, false, true, true]);
  assert.equal(units[0].changes[0].row_data, a.row_data);
  const malformed = operation(6, '女子300m'); delete malformed.row_data.updated_at;
  assert.deepEqual(obOperationReplayUnits([another, malformed]).map(unit => unit.changes.map(change => change.id)), [[5], [6]]);
});

test('a blocked partner holds both source snapshots and protects both mirrored primary keys', async () => {
  const a = operation(1, '男子100m', undefined, 5), b = operation(2, '女子100m', undefined, 0);
  const profile = { id: 3, attempts: 0, table_name: 'profiles', op: 'UPDATE', pk: { id: 'member' } };
  const calls = [];
  const result = await replayObChanges([a, b, profile], { maxAttempts: 5, applyChange: async change => { calls.push(change.id); return true; }, applyOperations: async () => { assert.fail('blocked pair must not send either side'); }, acknowledge: async members => calls.push(members.map(change => change.id)) });
  assert.deepEqual(result, { applied: 1, failed: 0 }); assert.deepEqual(calls, [3, [3]]);
  const held = obReplayProtection([a]);
  assert(held.get('ob_event_operations').has(JSON.stringify(a.pk)));
  assert(held.get('ob_event_operations').has(JSON.stringify(b.pk)));
  assert.equal(held.get('ob_event_operations').size, 2);
});

test('sends complete family snapshots through one RPC and acknowledges the pair once after atomic success', async () => {
  const a = operation(1, '男子100m'), b = operation(2, '女子100m'), calls = [];
  const result = await replayObChanges([a, b], { maxAttempts: 5, applyChange: async () => assert.fail('operation must use the family RPC'), applyOperations: async rows => { calls.push(rows); assert.equal(rows[0], a.row_data); assert.equal(rows[1], b.row_data); return true; }, acknowledge: async (members, outcome) => calls.push({ ids: members.map(change => change.id), outcome }) });
  assert.deepEqual(result, { applied: 2, failed: 0 });
  assert.deepEqual(calls[1], { ids: [1, 2], outcome: true }); assert.equal(calls.length, 2);
});

test('keeps a failed or uncertain pair together and never falls back to per-source overwrites', async () => {
  for (const outcome of ['operation_replay_conflict', new Error('connection unavailable')]) {
    const a = operation(1, '男子100m'), b = operation(2, '女子100m'), journal = [];
    const result = await replayObChanges([a, b], { maxAttempts: 5, applyChange: async () => assert.fail('no partial fallback'), applyOperations: async () => { if (outcome instanceof Error) throw outcome; return outcome; }, acknowledge: async (members, result) => journal.push({ members, result }) });
    assert.deepEqual(result, { applied: 0, failed: 2 }); assert.equal(journal.length, 1);
    assert.deepEqual(journal[0].members, [a, b]); assert.equal(journal[0].result, outcome instanceof Error ? outcome.message : outcome);
  }
});

test('replays an unpaired operation with the same RPC and retains the unit when acknowledgement is uncertain', async () => {
  const source = operation(1, '女子1500m'), sends = [];
  const api = { maxAttempts: 5, applyChange: async () => assert.fail('single operation still validates its peer'), applyOperations: async rows => { sends.push(rows); return true; }, acknowledge: async () => { throw new Error('journal acknowledgement unavailable'); } };
  await assert.rejects(replayObChanges([source], api), /acknowledgement/);
  assert.deepEqual(sends, [[source.row_data]]);
  api.acknowledge = async (members, outcome) => { assert.deepEqual(members, [source]); assert.equal(outcome, true); };
  assert.deepEqual(await replayObChanges([source], api), { applied: 1, failed: 0 });
  assert.deepEqual(sends, [[source.row_data], [source.row_data]]);
});

test('retains legacy audit dependency order and retry ceilings for non-operation tables', async () => {
  const audit = { id: 1, attempts: 0, table_name: 'ob_entry_changes', op: 'INSERT', pk: { id: 'audit' }, row_data: { after_data: { id: 'entry', revision: 3 } } };
  const entry = { id: 2, attempts: 0, table_name: 'ob_meet_entries', op: 'UPDATE', pk: { id: 'entry' }, row_data: { revision: 3 } };
  const blocked = { id: 3, attempts: 5, table_name: 'profiles', op: 'UPDATE', pk: { id: 'member' } };
  const seen = [];
  const result = await replayObChanges([audit, entry, blocked], { maxAttempts: 5, applyOperations: async () => assert.fail('unrelated tables never use operation RPC'), applyChange: async (change, headers) => { seen.push([change.id, headers]); return true; }, acknowledge: async () => {} });
  assert.deepEqual(seen, [[2, { 'x-tuat-mirror': '1' }], [1, {}]]); assert.deepEqual(result, { applied: 2, failed: 0 });
  assert(obReplayProtection([blocked]).get('profiles').has(JSON.stringify(blocked.pk)));
});

test('holds ambiguous same-source transaction snapshots as failures instead of losing one revision', async () => {
  const a = operation(1, '男子100m'), duplicate = operation(2, '男子100m'), b = operation(3, '女子100m');
  let seen;
  const result = await replayObChanges([a, duplicate, b], { maxAttempts: 5, applyChange: async () => assert.fail('no source fallback'), applyOperations: async () => assert.fail('ambiguous batch cannot be sent'), acknowledge: async (members, outcome) => { seen = { members, outcome }; } });
  assert.deepEqual(result, { applied: 0, failed: 3 }); assert.deepEqual(seen.members, [a, duplicate, b]); assert.equal(seen.outcome, 'operation_replay_conflict');
});
