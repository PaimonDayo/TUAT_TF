import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const version = 'clear-if-existing-v1';
const attempt = '11111111-1111-4111-8111-111111111111';
function fixture({ rows = [['日付', '曜日', '感想'], ['2026-10-10', '土', 'synthetic']], formulas = [], failFlush = false, busy = false } = {}) {
  const values = structuredClone(rows), events = [], writes = [];
  let inserted = 0;
  const sheet = {
    getName: () => 'B1 synthetic', getSheetId: () => 7,
    getDataRange: () => ({ getValues: () => values, getFormulas: () => values.map((row, i) => row.map((_, c) => formulas[i]?.[c] || '')) }),
    getRange: (row, column) => ({ getFormula: () => formulas[row - 1]?.[column - 1] || '', setValue(value) {
      writes.push({ row, column, value }); events.push('write'); values[row - 1][column - 1] = value;
    } }),
    getLastRow: () => values.length, insertRowAfter() { inserted++; values.push(values[0].map(() => '')); },
  };
  const workbook = { getId: () => 'synthetic_workbook', getSheets: () => [sheet], getSheetByName: name => name === sheet.getName() ? sheet : null };
  const ctx = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'SPREADSHEET_ID' ? workbook.getId() : 'synthetic-secret' }) },
    SpreadsheetApp: { openById: () => workbook, flush() { events.push('flush'); if (failFlush) throw new Error('synthetic flush failure'); } },
    LockService: { getScriptLock() { events.push('script-lock'); return {
      waitLock(ms) { events.push(`wait:${ms}`); if (busy) throw new Error('synthetic lock timeout'); },
      releaseLock() { events.push('release'); },
    }; } },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' }, Utilities: { formatDate: date => date.toISOString().slice(0, 10) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() {} }) },
  });
  vm.runInContext(readFileSync(new URL('../../gas/sync-clasp/Code.js', import.meta.url), 'utf8'), ctx);
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ secret: 'synthetic-secret', ...body }) } }).text);
  const metadata = () => post({ action: 'fetchMember', clearContract: version, memberName: sheet.getName() }).clearTarget;
  const clear = (overrides = {}) => {
    const target = metadata();
    return post({ action: 'clearIfExisting', contractVersion: version, attemptId: attempt,
      spreadsheetId: target.spreadsheetId, memberName: sheet.getName(), date: '2026-10-10',
      expectedSheetId: target.sheetId, expectedSheetName: target.sheetName,
      expectedHeaderRow: target.headerRow, expectedColumns: target.columns,
      clearColumns: [{ index: 2, header: '感想' }], ...overrides });
  };
  return { post, metadata, clear, values, events, writes, inserted: () => inserted };
}

test('metadata opt-in returns physical target and indexed headers without record values', () => {
  const f = fixture();
  assert.deepEqual(f.metadata(), { contractVersion: version, spreadsheetId: 'synthetic_workbook', sheetId: '7', sheetName: 'B1 synthetic',
    headerRow: 1, columns: [{ index: 0, label: '日付' }, { index: 1, label: '曜日' }, { index: 2, label: '感想' }] });
  assert.deepEqual(f.writes, []); assert.deepEqual(f.events, []);
  assert.ok(f.post({ action: 'fetchMember', clearContract: 'old', memberName: 'B1 synthetic' }).error);
});

for (const date of ['2026-10-10', '2026/10/10', '10/10', new Date('2026-10-10T00:00:00Z')]) {
  test(`actual date row supports ${typeof date === 'string' ? date : 'Date'} and clears linked input only`, () => {
    const f = fixture({ rows: [['日付', '曜日', '感想', 'unlinked'], [date, '土', 'synthetic', 'retained']] });
    const result = f.clear();
    assert.equal(result.outcome, 'cleared'); assert.equal(result.action, 'clearIfExisting'); assert.equal(result.attemptId, attempt);
    assert.deepEqual(result.clearedColumns, [2]); assert.deepEqual(f.writes, [{ row: 2, column: 3, value: '' }]);
    assert.equal(f.values[1][3], 'retained'); assert.equal(f.inserted(), 0);
    assert.deepEqual(f.events, ['script-lock', 'wait:10000', 'write', 'flush', 'release']);
  });
}

test('authoritative missing date never inserts a row or clears another date', () => {
  const f = fixture({ rows: [['日付', '曜日', '感想'], ['2026-10-09', '金', 'retained']] });
  const result = f.clear();
  assert.equal(result.outcome, 'missing'); assert.equal(result.row, null); assert.deepEqual(result.clearedColumns, []);
  assert.deepEqual(f.writes, []); assert.equal(f.inserted(), 0); assert.equal(f.values[1][2], 'retained');
  assert.deepEqual(f.events, ['script-lock', 'wait:10000', 'flush', 'release']);
});

test('duplicate target dates and unrecognized numeric dates refuse clear before any write', () => {
  for (const dates of [['2026-10-10', '10/10'], ['2026-10-10', '2026-02-30'], ['2026-10-10', '10.10'], ['１０/１０'], ['unrecognized date text']]) {
    const f = fixture({ rows: [['日付', '曜日', '感想'], ...dates.map(date => [date, '土', 'retained'])] });
    assert.ok(f.clear().error); assert.deepEqual(f.writes, []); assert.equal(f.inserted(), 0); assert.equal(f.events.at(-1), 'release');
  }
});

test('known summary rows are skipped without protecting a manually entered daily total', () => {
  const f = fixture({ rows: [['日付', '曜日', '走行距離'], ['2026-10-10', '土', 5], ['月間合計', '', 30]], formulas: [[], [], ['', '', '=SUM(C2:C3)']] });
  const result = f.clear({ clearColumns: [{ index: 2, header: '走行距離' }] });
  assert.equal(result.outcome, 'cleared'); assert.deepEqual(f.writes, [{ row: 2, column: 3, value: '' }]);
});

test('clear preserves date/day/weekly/formula and damaged calculated totals, reports requested skips', () => {
  const headers = ['日付', '曜日', '週合計', '実際の距離', '任意式', '感想'];
  const f = fixture({ rows: [headers, ['2026-10-10', '土', 10, 5, 7, 'clear'], ['2026-10-11', '日', 10, 5, 7, 'retained']],
    formulas: [[], ['', '', '', '', '=1+2'], ['', '', '', '=F3']] });
  const result = f.clear({ clearColumns: headers.map((header, index) => ({ index, header })) });
  assert.equal(result.outcome, 'partial'); assert.deepEqual(result.protectedHeaders, headers.slice(0, 5));
  assert.deepEqual(f.writes, [{ row: 2, column: 6, value: '' }]); assert.equal(f.inserted(), 0);
});

test('unmapped configured input is a known partial, never full acknowledgement', () => {
  const f = fixture(); const result = f.clear({ clearColumns: [{ index: 2, header: '感想' }, { index: null, header: 'missing' }] });
  assert.equal(result.outcome, 'partial'); assert.deepEqual(result.unmapped, ['missing']); assert.deepEqual(result.clearedColumns, [2]);
});

test('metadata/header/workbook/sheet/version changes fail closed before cell writes', () => {
  const cases = [{ expectedSheetId: '8' }, { expectedSheetName: 'B2 synthetic' }, { expectedHeaderRow: 2 },
    { expectedColumns: [{ index: 0, label: 'changed' }] }, { spreadsheetId: 'other_workbook' },
    { contractVersion: 'old' }, { clearColumns: [{ index: 2, header: 'changed' }] },
    { clearColumns: [{ index: 2, header: '感想' }, { index: 2, header: '感想' }] }];
  for (const change of cases) { const f = fixture(); assert.ok(f.clear(change).error); assert.deepEqual(f.writes, []); assert.equal(f.inserted(), 0); }
});

test('finite lock timeout emits no success; flush failure after dispatch stays unconfirmed and releases lock', () => {
  const busy = fixture({ busy: true }); assert.ok(busy.clear().error); assert.deepEqual(busy.writes, []);
  assert.deepEqual(busy.events, ['script-lock', 'wait:10000']);
  const failed = fixture({ failFlush: true }); assert.ok(failed.clear().error); assert.equal(failed.writes.length, 1); assert.equal(failed.events.at(-1), 'release');
});

test('normal writeCells participates in the same lock and retains existing row-creation behavior', () => {
  const f = fixture();
  const result = f.post({ action: 'writeCells', memberName: 'B1 synthetic', date: '2026-10-12', cells: { 感想: 'new input' } });
  assert.equal(result.action, 'created'); assert.equal(f.inserted(), 1);
  assert.equal(f.events[0], 'script-lock'); assert.equal(f.events[1], 'wait:10000'); assert.deepEqual(f.events.slice(-2), ['flush', 'release']);
});
