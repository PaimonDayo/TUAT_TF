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
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL('../../gas/sync-clasp/Code.js', import.meta.url), 'utf8'), context);
  context.findMemberSheet = () => sheet;
  context.findRecordRow = () => 1;
  return { writes, write: cells => context.writeCellsRecord({ memberName: 'テスト', date: '2026-10-01', cells }) };
}

test('record save and delete preserve daily total formulas and weekly totals', () => {
  for (const value of [12, 0, '']) {
    const { writes, write } = setup(['日付', '曜日', '実際の距離', '週合計', '低強度', '感想'], { 3: '=E2', 4: '=SUM(C2:C8)' });
    const result = write({ 実際の距離: value, 週合計: value, 低強度: value, 感想: '入力' });
    assert.deepEqual(writes, [{ row: 2, column: 5, value }, { row: 2, column: 6, value: '入力' }]);
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
