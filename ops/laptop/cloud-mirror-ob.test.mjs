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
