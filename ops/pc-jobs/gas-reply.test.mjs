import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function setup() {
  const values = [['date', 'memo', '', ''], ['2026-09-28', 'record', '', '']];
  const notes = ['', '', '', ''];
  let locks = 0, writes = 0;
  const ctx = vm.createContext({ LockService: {getScriptLock: () => ({waitLock(){locks++;}, releaseLock(){locks--;}})}, SpreadsheetApp: {flush(){}} });
  vm.runInContext(readFileSync(new URL('../../gas/sync-clasp/Code.js', import.meta.url),'utf8'),ctx);
  ctx.findMemberSheet = () => ({getDataRange: () => ({getValues: () => values}), getMaxColumns: () => 4, getRange(row, col) {return {getNotes: () => [notes], setNote(note){notes[col-1]=note;},setNumberFormat(format){assert.equal(format,'@');},setValue(text){assert.equal(locks,1);values[row-1][col-1]=text;writes++;}};}});
  ctx.findGenericHeaderIndex = () => 0;
  ctx.findRecordRow = () => 1;
  ctx.findNextReplyColumn = () => 2;
  return {ctx,values,notes,getWrites:()=>writes,getLocks:()=>locks};
}
test('reply retries reuse their original cell and write literal text', () => {
  const t=setup(), input={memberName:'test',date:'2026-09-28',text:'=literal',sourceId:'comment-1'};
  assert.equal(t.ctx.writeReplyRecord(input).col,3);
  assert.equal(t.values[1][2],"'=literal");
  assert.equal(t.ctx.writeReplyRecord(input).action,'already_replied');
  assert.equal(t.getWrites(),1);assert.equal(t.getLocks(),0);
});
test('an interrupted reserved cell is recovered and locks release on failure', () => {
  const t=setup();t.notes[2]='TUAT_APP_COMMENT:comment-1';
  assert.equal(t.ctx.writeReplyRecord({memberName:'test',date:'2026-09-28',text:'reply',sourceId:'comment-1'}).col,3);
  assert.throws(()=>t.ctx.writeReplyRecord({}),/必須/);assert.equal(t.getLocks(),0);
});
test('new replies cannot reuse another interrupted reservation', () => {
  const t=setup();t.notes[2]='TUAT_APP_COMMENT:other-comment';
  t.ctx.findNextReplyColumn=(_sheet,row)=>{assert.equal(row[2],'reserved');return 3;};
  assert.equal(t.ctx.writeReplyRecord({memberName:'test',date:'2026-09-28',text:'reply',sourceId:'new-comment'}).col,4);
  assert.equal(t.notes[2],'TUAT_APP_COMMENT:other-comment');
});
test('appending a reply column returns a zero-based index', () => {
  const ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../../gas/sync-clasp/Code.js',import.meta.url),'utf8'),ctx);
  let size=3;const sheet={getMaxColumns:()=>size,insertColumnAfter(col){assert.equal(col,size);size++;}};
  assert.equal(ctx.findNextReplyColumn(sheet,['date','memo','old reply'],['日付','感想','']),3);
  assert.equal(size,4);
});
