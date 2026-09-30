import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const next = '18HKZrVL-JtXbZ9zcYUFPRPGIGCpd7ltLOsmvBKdJfR8';
function setup() {
  const opened = [];
  const context = vm.createContext({ PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'SYNC_SECRET' ? 'test-secret' : 'old-id' }) },
    SpreadsheetApp: { openById: id => { opened.push(id); return { getSheets: () => [] }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() {} }) } });
  vm.runInContext(readFileSync(new URL('../../gas/sync-clasp/Code.js', import.meta.url), 'utf8'), context);
  const post = body => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { context, opened, post };
}
test('authenticated requests select only the approved workbook and reset after every request', () => {
  const { post, opened } = setup();
  assert.deepEqual(post({ action: 'listMembers', secret: 'test-secret', spreadsheetId: next }), { members: [] });
  post({ action: 'listMembers', secret: 'test-secret' });
  assert.deepEqual(opened, [next, 'old-id']);
  assert.match(post({ action: 'listMembers', secret: 'test-secret', spreadsheetId: 'unapproved' }).error, /not allowed/);
  assert.match(post({ action: 'writeCells', secret: 'test-secret', spreadsheetId: next, date: '2026-09-30' }).error, /outside/);
  assert.match(post({ action: 'listMembers', secret: 'wrong', spreadsheetId: next }).error, /unauthorized/);
  assert.equal(opened.length, 2);
});
