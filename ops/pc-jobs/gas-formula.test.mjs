import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function setup(headers, formulas = {}) {
  const writes = [];
  const sheet = {
    getDataRange: () => ({ getValues: () => [headers, ['10/1', '木'], [formulas.neighborDate ?? '10/2', '金']],
      getFormulas: () => [headers.map(() => ''), headers.map((_, i) => formulas[i + 1] || ''), headers.map((_, i) => formulas.neighbor?.[i + 1] || '')] }),
    getRange: (row, column) => ({
      getFormula: () => formulas[column] || '',
      setValue: value => writes.push({ row, column, value }),
    }),
  };
  const context = vm.createContext({ LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, SpreadsheetApp: { flush() {} } });
  vm.runInContext(readFileSync(new URL('../../gas/sync-clasp/Code.js', import.meta.url), 'utf8'), context);
  context.findMemberSheet = () => sheet;
  context.findRecordRow = () => 1;
  return { writes, write: cells => context.writeCellsRecord({ memberName: 'テスト', date: '2026-10-01', cells }) };
}

test('record save and delete preserve daily total formulas and weekly totals', () => {
  for (const value of [12, 0, '']) {
    const { writes, write } = setup(['日付', '曜日', '実際の距離', '週合計', '低強度', '感想'], { 3: '=E2', 4: '=SUM(C2:C8)' });
    const result = write({ 実際の距離: value, 週合計: value, 低強度: value, 感想: '入力' });
    assert.deepEqual(writes, [{ row: 2, column: 5, value }, { row: 2, column: 6, value: "'入力" }]);
    assert.deepEqual(Array.from(result.protectedHeaders), ['実際の距離', '週合計']);
  }
});

test('a damaged calculated total remains protected even when its formula is already missing', () => {
  const { writes, write } = setup(['日付', '曜日', '実際の距離', '低強度'], { neighbor: { 3: '=D3' } });
  write({ 実際の距離: '', 低強度: 5 });
  assert.deepEqual(writes, [{ row: 2, column: 4, value: 5 }]);
});

test('other existing formulas and date columns survive custom field mappings', () => {
  const { writes, write } = setup(['日付', '曜日', '任意集計', '感想'], { 3: '=SUM(E2:F2)' });
  write({ 日付: '', 曜日: '', 任意集計: '', 感想: '' });
  assert.deepEqual(writes, [{ row: 2, column: 4, value: '' }]);
});

test('manual total distance remains writable in sheets without intensity inputs or a formula', () => {
  const { writes, write } = setup(['日付', '曜日', '走行距離']);
  write({ 走行距離: 5 });
  assert.deepEqual(writes, [{ row: 2, column: 3, value: 5 }]);
});

test('manual total distance stays writable even alongside intensity columns', () => {
  const { writes, write } = setup(['日付', '曜日', '実際の走行距離', '低強度']);
  write({ 実際の走行距離: 5 });
  assert.deepEqual(writes, [{ row: 2, column: 3, value: 5 }]);
});

test('a monthly summary formula does not turn daily manual distance into a calculated column', () => {
  const { writes, write } = setup(['日付', '曜日', '実際の走行距離', '低強度'], { neighbor: { 3: '=SUM(C2:C29)' }, neighborDate: '' });
  write({ 実際の走行距離: 5 });
  assert.deepEqual(writes, [{ row: 2, column: 3, value: 5 }]);
});

function writeFixture(headers, dates = ['2026-10-01']) {
  const writes = [], values = [headers, ...dates.map(date => [date, ...headers.slice(1).map(() => '')])];
  let inserted = 0, released = 0;
  const sheet = { getDataRange: () => ({ getValues: () => values, getFormulas: () => values.map(row => row.map(() => '')) }),
    getLastRow: () => values.length, insertRowAfter() { inserted++; values.push(headers.map(() => '')); },
    getRange: (row, column) => ({ getFormula: () => '', setValue: value => writes.push({ row, column, value }) }) };
  const ctx = vm.createContext({ SpreadsheetApp: { flush() {} }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() { released++; } }) } });
  vm.runInContext(readFileSync(new URL('../../gas/sync-clasp/Code.js', import.meta.url), 'utf8'), ctx);
  ctx.findMemberSheet = () => sheet;
  return { writes, inserted: () => inserted, released: () => released,
    write: (cells, date = '2026-10-01') => ctx.writeCellsRecord({ memberName: 'synthetic', date, cells }) };
}

test('duplicate target dates refuse all writes before updating or inserting', () => {
  const f = writeFixture(['日付', '感想'], ['2026-10-01', '10/1']);
  assert.throws(() => f.write({ 感想: 'synthetic' }), /複数/);
  assert.deepEqual(f.writes, []); assert.equal(f.inserted(), 0); assert.equal(f.released(), 1);
});

test('ambiguous normalized headers refuse the complete request before any row creation', () => {
  for (const date of ['2026-10-01', '2026-10-02']) {
    const f = writeFixture(['日付', '感想', '感 想', '低強度']);
    assert.throws(() => f.write({ 低強度: 5, 感想: 'synthetic' }, date), /曖昧/);
    assert.deepEqual(f.writes, []); assert.equal(f.inserted(), 0);
  }
});

test('text is sent as literal text while real numeric values retain their type', () => {
  for (const value of ['=1+1', '+1', '-1', '@text', '001', "'quoted", 'plain']) {
    const f = writeFixture(['日付', '感想', '低強度']); f.write({ 感想: value, 低強度: 5 });
    assert.deepEqual(f.writes, [{ row: 2, column: 2, value: "'" + value }, { row: 2, column: 3, value: 5 }]);
  }
  const f = writeFixture(['日付', '感想', '低強度']); f.write({ 感想: '', 低強度: 0 });
  assert.deepEqual(f.writes.map(item => item.value), ['', 0]);
});

test('monthly menu writes reject duplicate dates before mutation and keep text literal', () => {
  const values = [['synthetic title', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''],
    ['2', '曜日', '時間', '場所', 'メニュー', 'ペース', '補足', '列 8'], ['2026-10-01', '', '', '', '', '', '', '']];
  const writes = []; let released = 0;
  const sheet = { getDataRange: () => ({ getValues: () => values }), getRange: (...target) => ({ setValues: rows => writes.push({ target, rows }) }) };
  const ctx = vm.createContext({ SpreadsheetApp: { flush() {} }, LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() { released++; } }) } });
  vm.runInContext(readFileSync(new URL('../../gas/sync-clasp/Code.js', import.meta.url), 'utf8'), ctx);
  ctx.getSpreadsheet = () => ({ getSheetByName: () => sheet });
  const input = { date: '2026-10-01', content: '=1+1', pace: '001', remark: 'plain', supplement: '' };
  values.push(['2026/10/01', '', '', '', '', '', '', '']);
  assert.throws(() => ctx.writeMiddleLongMenuRecord(input), /複数/); assert.deepEqual(writes, []);
  values.pop(); ctx.writeMiddleLongMenuRecord(input);
  assert.deepEqual(Array.from(writes[0].rows[0]), ["'=1+1", "'001", "'plain", '']); assert.equal(released, 2);
});
