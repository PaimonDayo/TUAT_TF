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
  ctx.findMemberSheet = () => ({getDataRange: () => ({getValues: () => values}), getMaxColumns: () => 4, getRange(row, col) {return {getNotes: () => [notes], setNote(note){notes[col-1]=note;},clearContent(){assert.equal(locks,1);values[row-1][col-1]='';},setNumberFormat(format){assert.equal(format,'@');},setValue(text){assert.equal(locks,1);values[row-1][col-1]=text;writes++;}};}});
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

test('deletion clears only the identified reply and prevents delayed resends',()=>{
 const t=setup(),input={memberName:'test',date:'2026-09-28',text:'reply',sourceId:'comment-1'};
 t.ctx.writeReplyRecord(input);t.values[1][3]='other reply';
 const deletion={memberName:'test',date:input.date,sourceId:'comment-1',deletionId:'comment-1',replyIndex:2,expectedText:"'reply"};
 assert.equal(t.ctx.deleteReplyRecord(deletion).success,true);
 assert.equal(t.values[1][2],'');assert.equal(t.values[1][1],'record');assert.equal(t.values[1][3],'other reply');
 assert.equal(t.ctx.writeReplyRecord(input).action,'deleted');
 assert.equal(t.ctx.deleteReplyRecord(deletion).action,'already_deleted');
});
test('delete-before-send reserves a tombstone and refuses later delivery',()=>{
 const t=setup();
 t.ctx.deleteReplyRecord({memberName:'test',date:'2026-09-28',sourceId:'not-sent',deletionId:'not-sent',expectedText:'reply'});
 assert.equal(t.ctx.writeReplyRecord({memberName:'test',date:'2026-09-28',sourceId:'not-sent',text:'reply'}).action,'deleted');
 assert.equal(t.getWrites(),0);
});
test('sheet-origin deletion checks the column and content before clearing',()=>{
 const t=setup();t.values[1][2]='original';
 const input={memberName:'test',date:'2026-09-28',deletionId:'sheet-1',replyIndex:2,expectedText:'stale'};
 assert.throws(()=>t.ctx.deleteReplyRecord(input),/変更/);assert.equal(t.values[1][2],'original');
 assert.throws(()=>t.ctx.deleteReplyRecord({...input,replyIndex:1,expectedText:'record'}),/返信列/);
 assert.equal(t.ctx.deleteReplyRecord({...input,expectedText:'original'}).success,true);
 t.values[1][2]='new manual reply';
 assert.throws(()=>t.ctx.deleteReplyRecord({...input,expectedText:'original'}),/別の返信/);
 assert.equal(t.values[1][2],'new manual reply');assert.equal(t.getLocks(),0);
});
test('interrupted deletion resumes safely without clearing an intervening edit',()=>{
 const t=setup();t.values[1][2]='original';t.notes[2]='TUAT_DELETING_COMMENT:c1:"original"';
 const input={memberName:'test',date:'2026-09-28',deletionId:'c1',sourceId:'c1',expectedText:'original'};
 assert.equal(t.ctx.writeReplyRecord({...input,text:'new'}).action,'deleted');
 t.values[1][2]='edited';assert.throws(()=>t.ctx.deleteReplyRecord(input),/変更/);
 t.values[1][2]='original';assert.equal(t.ctx.deleteReplyRecord(input).success,true);assert.equal(t.values[1][2],'');
});

test('a CSV-imported app copy can be deleted and its original ID blocks delayed sends',()=>{
 const t=setup();t.values[1][2]='original';t.values[1][3]='other';t.notes[2]='TUAT_APP_COMMENT:original-app';
 const input={memberName:'test',date:'2026-09-28',deletionId:'imported-reply',replyIndex:2,expectedText:'original'};
 assert.equal(t.ctx.deleteReplyRecord(input).success,true);
 assert.equal(t.values[1][2],'');assert.equal(t.values[1][3],'other');assert.equal(t.values[1][1],'record');
 assert.equal(t.notes[2],'TUAT_DELETED_COMMENT:original-app');
 assert.equal(t.ctx.writeReplyRecord({...input,text:'original',sourceId:'original-app'}).action,'deleted');
 assert.equal(t.ctx.deleteReplyRecord(input).action,'already_deleted');
 t.values[1][2]='new reply';assert.throws(()=>t.ctx.deleteReplyRecord(input),/別の返信/);assert.equal(t.values[1][2],'new reply');
});

test('a CSV-imported app deletion still rejects changed text and labelled columns',()=>{
 const t=setup();t.values[1][2]='changed';t.notes[2]='TUAT_APP_COMMENT:original-app';
 const input={memberName:'test',date:'2026-09-28',deletionId:'imported-reply',replyIndex:2,expectedText:'original'};
 assert.throws(()=>t.ctx.deleteReplyRecord(input),/変更/);assert.equal(t.values[1][2],'changed');
 t.notes[1]='TUAT_APP_COMMENT:original-app';assert.throws(()=>t.ctx.deleteReplyRecord({...input,replyIndex:1,expectedText:'record'}),/返信列/);
 assert.equal(t.getLocks(),0);
});

test('an interrupted imported-app deletion resumes using its original app identity',()=>{
 const t=setup();t.values[1][2]='original';t.notes[2]='TUAT_DELETING_COMMENT:original-app:"original"';
 const input={memberName:'test',date:'2026-09-28',deletionId:'imported-reply',replyIndex:2,expectedText:'original'};
 assert.throws(()=>t.ctx.deleteReplyRecord({...input,expectedText:'different'}),/変更/);
 assert.equal(t.ctx.deleteReplyRecord(input).success,true);assert.equal(t.values[1][2],'');
 assert.equal(t.notes[2],'TUAT_DELETED_COMMENT:original-app');
});
