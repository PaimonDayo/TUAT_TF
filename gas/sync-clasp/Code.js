/**
 * TUAT T&F アプリ 同期API（単体スクリプト・secretなし）
 * 別プロジェクトに「これだけ」貼ればよい（旧アプリのコードは不要）。
 *   GET  ?action=listMembers
 *   GET  ?action=fetchAllRaw
 *   GET  ?action=fetchMember&memberName=...（1部員のみ。write-through用の軽量版）
 *   POST { action:'writeCells', memberName, date, cells:{見出し:値} }
 */

const SPREADSHEET_ID = '1uAo7E8_rMbUZlml1H0vj119htQeoa2eMWqASUXQTqgg';

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function createJsonResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// secret は publicリポジトリに置かない。
// 実体は gitignore した secret.js の SYNC_SECRET_VALUE（claspでGASにのみpush）か、
// または Script Properties の SYNC_SECRET から読む。どちらも無ければ全拒否。
function getSyncSecret() {
  if (typeof SYNC_SECRET_VALUE !== 'undefined' && SYNC_SECRET_VALUE) return SYNC_SECRET_VALUE;
  return PropertiesService.getScriptProperties().getProperty('SYNC_SECRET') || '';
}
function verifySyncSecret(provided) {
  const s = getSyncSecret();
  if (!s) throw new Error('SYNC_SECRET not set'); // 未設定なら全拒否（fail closed）
  if ((provided || '').toString() !== s) throw new Error('unauthorized');
}

// 管理用：Script Properties に secret を設定する（owner が clasp run で呼ぶ。Web公開はしていない）。
function setSecret(s) {
  PropertiesService.getScriptProperties().setProperty('SYNC_SECRET', (s || '').toString());
  return 'len=' + getSyncSecret().length;
}

// 管理用: 週次バックアップ先APIを設定し、日曜03:00〜04:00のトリガーを作る。
function setupWeeklyBackup(apiUrl) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('BACKUP_API_URL', (apiUrl || 'https://tuat-tf.vercel.app').toString().replace(/\/$/, ''));
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'runWeeklyBackup')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('runWeeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
}

// 主要テーブルをDriveの TUAT-TF Backups 配下へ保存し、直近8世代だけ保持する。
function runWeeklyBackup() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('BACKUP_API_URL') || 'https://tuat-tf.vercel.app';
  const secret = getSyncSecret();
  if (!secret) throw new Error('SYNC_SECRET not set');
  const response = UrlFetchApp.fetch(apiUrl + '/api/backup', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + secret },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new Error('backup API: ' + response.getContentText());
  const payload = JSON.parse(response.getContentText());
  const rootIterator = DriveApp.getFoldersByName('TUAT-TF Backups');
  const root = rootIterator.hasNext() ? rootIterator.next() : DriveApp.createFolder('TUAT-TF Backups');
  const stamp = Utilities.formatDate(new Date(payload.createdAt), 'Asia/Tokyo', 'yyyy-MM-dd_HHmmss');
  const folder = root.createFolder(stamp);
  payload.exports.forEach(item => folder.createFile(item.table + '.csv', item.csv, MimeType.CSV));
  folder.createFile('manifest.json', JSON.stringify({ createdAt: payload.createdAt, tables: payload.exports.map(item => ({ table: item.table, rowCount: item.rowCount })) }, null, 2), MimeType.PLAIN_TEXT);

  const generations = [];
  const iterator = root.getFolders();
  while (iterator.hasNext()) generations.push(iterator.next());
  generations.sort((a, b) => b.getName().localeCompare(a.getName()));
  generations.slice(8).forEach(oldFolder => oldFolder.setTrashed(true));
  return { success: true, folder: stamp, files: payload.exports.length + 1 };
}

function doGet(e) {
  try {
    const action = e && e.parameter ? e.parameter.action : '';
    if (action === 'listMembers') {
      verifySyncSecret(e.parameter.secret);
      return handleListMembers();
    }
    if (action === 'fetchAllRaw') {
      verifySyncSecret(e.parameter.secret);
      return handleFetchAllRaw();
    }
    if (action === 'fetchMember') {
      verifySyncSecret(e.parameter.secret);
      return handleFetchMember(e.parameter.memberName);
    }
    return createJsonResponse({ error: 'unknown action' });
  } catch (err) {
    return createJsonResponse({ error: err.toString() });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    verifySyncSecret(body.secret);
    if (body.action === 'writeCells') return createJsonResponse(writeCellsRecord(body));
    if (body.action === 'writeReply') return createJsonResponse(writeReplyRecord(body));
    if (body.action === 'setupWeeklyBackup') {
      setupWeeklyBackup(body.apiUrl);
      return createJsonResponse(runWeeklyBackup());
    }
    if (body.action === 'runBackupNow') return createJsonResponse(runWeeklyBackup());
    return createJsonResponse({ error: 'unknown action' });
  } catch (err) {
    return createJsonResponse({ error: err.toString() });
  }
}

function normalizeHeaderCell(cell) {
  return cell.toString().replace(/\s+/g, '').trim();
}

// 「日付」を含む行を見出し行とみなす（中長距離=1行目／短距離=2行目どちらも対応）
function findGenericHeaderIndex(values) {
  for (let i = 0; i < Math.min(15, values.length); i++) {
    if (values[i].some(cell => normalizeHeaderCell(cell) === '日付')) return i;
  }
  return -1;
}

function findRecordRow(values, headerIdx, date) {
  for (let i = headerIdx + 1; i < values.length; i++) {
    const raw = values[i][0];
    if (!raw) continue;
    if (parseSheetDate(raw) === date) return i;
  }
  return -1;
}

function parseSheetDate(raw) {
  if (Object.prototype.toString.call(raw) === '[object Date]' && !isNaN(raw)) {
    return Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = raw.toString().trim().split(' ')[0];
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split('/').map(p => p.trim());
  const year = new Date().getFullYear();
  if (parts.length === 2) return year + '-' + parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0');
  if (parts.length === 3) return parts[0] + '-' + parts[1].padStart(2, '0') + '-' + parts[2].padStart(2, '0');
  return s;
}

function handleListMembers() {
  const members = [];
  const sheets = getSpreadsheet().getSheets();
  for (const sheet of sheets) {
    const name = sheet.getName();
    if (/^[BM]\d/.test(name)) members.push({ name: name, gid: sheet.getSheetId().toString() });
  }
  members.sort((a, b) => a.name.localeCompare(b.name));
  return createJsonResponse({ members: members });
}

// 1シート分をfetchAllRawと同じ形式で読む（部員個別取得の共通部）
function readMemberSheet(sheet) {
  const name = sheet.getName();
  const values = sheet.getDataRange().getDisplayValues();
  const hIdx = findGenericHeaderIndex(values);
  if (hIdx === -1) return null;
  const header = values[hIdx].map(c => c.toString().trim());
  const records = [];
  for (const row of values.slice(hIdx + 1)) {
    const dateRaw = row[0] ? row[0].toString().trim() : '';
    if (!dateRaw || !/^\d{1,2}\/\d{1,2}/.test(dateRaw)) continue;
    const cells = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      if (cells[key] === undefined) cells[key] = row[c] != null ? row[c].toString() : '';
    }
    records.push({ date: parseSheetDate(dateRaw), cells: cells });
  }
  return { name: name, gid: sheet.getSheetId().toString(), header: header.filter(Boolean), records: records };
}

function handleFetchAllRaw() {
  const out = [];
  const sheets = getSpreadsheet().getSheets();
  for (const sheet of sheets) {
    const name = sheet.getName();
    if (!/^[BM]\d/.test(name)) continue;
    const member = readMemberSheet(sheet);
    if (member) out.push(member);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return createJsonResponse({ data: out });
}

// 部員1人だけを軽量取得（write-through保存直後の反映確認・個人の記録画面用。
// 100人規模でも毎回全員分(fetchAllRaw)を読まずに済む）
function handleFetchMember(memberName) {
  if (!memberName) return createJsonResponse({ error: 'memberName は必須です。' });
  const sheet = getSpreadsheet().getSheetByName(memberName);
  if (!sheet) return createJsonResponse({ error: 'シート「' + memberName + '」が見つかりません。' });
  const member = readMemberSheet(sheet);
  if (!member) return createJsonResponse({ error: '見出し行（日付）が見つかりません。' });
  return createJsonResponse({ data: member });
}

// 見出し名でセルを upsert（実際の距離などの数式列は触らない＝渡された見出しだけ書く）
function writeCellsRecord(data) {
  const memberName = data.memberName;
  const date = data.date;
  const cells = data.cells || {};
  if (!memberName || !date) throw new Error('memberName と date は必須です。');

  const sheet = getSpreadsheet().getSheetByName(memberName);
  if (!sheet) throw new Error('シート「' + memberName + '」が見つかりません。');

  const values = sheet.getDataRange().getValues();
  const hIdx = findGenericHeaderIndex(values);
  if (hIdx === -1) throw new Error('見出し行（日付）が見つかりません。');

  const colOf = {};
  const headerRow = values[hIdx];
  for (let c = 0; c < headerRow.length; c++) {
    const norm = normalizeHeaderCell(headerRow[c]);
    if (norm && colOf[norm] === undefined) colOf[norm] = c;
  }

  let rowIdx = findRecordRow(values, hIdx, date);
  let sheetRowNum;
  if (rowIdx === -1) {
    const insertAfter = sheet.getLastRow();
    sheet.insertRowAfter(insertAfter);
    sheetRowNum = insertAfter + 1;
    const targetDate = new Date(date);
    sheet.getRange(sheetRowNum, 1).setValue((targetDate.getMonth() + 1) + '/' + targetDate.getDate());
    sheet.getRange(sheetRowNum, 2).setValue(['日', '月', '火', '水', '木', '金', '土'][targetDate.getDay()]);
  } else {
    sheetRowNum = rowIdx + 1;
  }

  const unmapped = [];
  Object.keys(cells).forEach(function (h) {
    const col = colOf[normalizeHeaderCell(h)];
    if (col === undefined) {
      unmapped.push(h);
      return;
    }
    sheet.getRange(sheetRowNum, col + 1).setValue(cells[h]);
  });

  return {
    success: true,
    action: rowIdx === -1 ? 'created' : 'updated',
    row: sheetRowNum,
    unmapped: unmapped, // 見出しが見つからず書き込めなかった項目（タブに列が無いケースの可視化用）
  };
}

// ── リプライ（旧TFと同じ：感想列より右の「列名なし」列に左から書き足す）─────────
function findHeaderCol(header, keywords) {
  const normalized = header.map(normalizeHeaderCell);
  return normalized.findIndex(function (cell) {
    return keywords.some(function (k) { return cell.indexOf(k) !== -1; });
  });
}

function getCommentColumn(header) {
  return findHeaderCol(header, ['感想', 'コメント', '反省', '状態']);
}

function findNextReplyColumn(sheet, row, header) {
  const commentCol = getCommentColumn(header);
  const startCol = commentCol !== -1 ? commentCol + 1 : header.length;
  let rightmostReplyCol = startCol - 1;
  for (let col = startCol; col < sheet.getMaxColumns(); col++) {
    const headerText = (header[col] || '').toString().trim();
    if (headerText) continue; // 見出しのある列（状態・睡眠時間など）は飛ばす
    if ((row[col] || '').toString().trim() !== '') rightmostReplyCol = col;
  }
  let nextCol = rightmostReplyCol + 1;
  while (nextCol < sheet.getMaxColumns() && (header[nextCol] || '').toString().trim() !== '') {
    nextCol += 1;
  }
  if (nextCol >= sheet.getMaxColumns()) {
    sheet.insertColumnAfter(sheet.getMaxColumns());
    return sheet.getMaxColumns();
  }
  return nextCol;
}

// payload: { action:'writeReply', memberName, date, text }
function writeReplyRecord(data) {
  const memberName = data.memberName;
  const date = data.date;
  const text = (data.text || '').toString().trim();
  if (!memberName || !date || !text) throw new Error('memberName, date, text は必須です。');

  const sheet = getSpreadsheet().getSheetByName(memberName);
  if (!sheet) throw new Error('シート「' + memberName + '」が見つかりません。');

  const values = sheet.getDataRange().getValues();
  const hIdx = findGenericHeaderIndex(values);
  if (hIdx === -1) throw new Error('見出し行（日付）が見つかりません。');

  const rowIdx = findRecordRow(values, hIdx, date);
  if (rowIdx === -1) return { success: false, action: 'no_row' }; // その日の行が無ければ何もしない

  const col = findNextReplyColumn(sheet, values[rowIdx], values[hIdx]);
  sheet.getRange(rowIdx + 1, col + 1).setValue(text);
  return { success: true, action: 'replied', row: rowIdx + 1, col: col + 1 };
}
