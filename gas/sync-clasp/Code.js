const OCTOBER_SPREADSHEET_ID = '18HKZrVL-JtXbZ9zcYUFPRPGIGCpd7ltLOsmvBKdJfR8';
const CLEAR_CONTRACT_VERSION = 'clear-if-existing-v1';
let requestSpreadsheetId = '';

/**
 * TUAT T&F app sync API (shared secret required).
 * All application calls use POST; spreadsheet sharing and permissions stay unchanged.
 */

function getSpreadsheetId() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
  if (!id) throw new Error('SPREADSHEET_ID not set');
  return id;
}

function getSpreadsheet() {
  return SpreadsheetApp.openById(requestSpreadsheetId || getSpreadsheetId());
}

// Owner-only helper for setting Script Properties manually. Never called by the web app.
function setSpreadsheetId(id) {
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', (id || '').toString());
  return 'configured=' + Boolean(getSpreadsheetId());
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

function doGet() {
  return createJsonResponse({ error: 'POST required' });
}
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    verifySyncSecret(body.secret);
    const target = body.spreadsheetId || getSpreadsheetId();
    if (target !== getSpreadsheetId() && target !== OCTOBER_SPREADSHEET_ID) throw new Error('Spreadsheet not allowed');
    if (target === OCTOBER_SPREADSHEET_ID && body.date && body.date < '2026-10-01') throw new Error('Date outside spreadsheet period');
    requestSpreadsheetId = target;
    if (body.action === 'listMembers') return handleListMembers();
    if (body.action === 'fetchAllRaw') return handleFetchAllRaw();
    if (body.action === 'fetchMember') return body.clearContract !== undefined
      ? createJsonResponse(readClearTarget(body)) : handleFetchMember(body.memberName);
    if (body.action === 'writeCells') return createJsonResponse(writeCellsRecord(body));
    if (body.action === 'clearIfExisting') return createJsonResponse(clearIfExistingRecord(body));
    if (body.action === 'writeMiddleLongMenu') return createJsonResponse(writeMiddleLongMenuRecord(body));
    if (body.action === 'deleteReply') return createJsonResponse(deleteReplyRecord(body));
    if (body.action === 'writeReply') return createJsonResponse(writeReplyRecord(body));
    return createJsonResponse({ error: 'unknown action' });
  } catch (err) {
    return createJsonResponse({ error: err.toString() });
  } finally {
    requestSpreadsheetId = '';
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
  const year = requestSpreadsheetId === OCTOBER_SPREADSHEET_ID ? (Number(parts[0]) < 10 ? 2027 : 2026) : new Date().getFullYear();
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
  const range = sheet.getDataRange();
  const values = range.getDisplayValues();
  const notes = range.getNotes();
  const hIdx = findGenericHeaderIndex(values);
  if (hIdx === -1) return null;
  const header = values[hIdx].map(c => c.toString().trim());
  const commentCol = getCommentColumn(header);
  const records = [];
  for (let rowOffset = 0; rowOffset < values.length - hIdx - 1; rowOffset++) {
    const row = values[hIdx + 1 + rowOffset];
    const noteRow = notes[hIdx + 1 + rowOffset] || [];
    const dateRaw = row[0] ? row[0].toString().trim() : '';
    if (!dateRaw || !/^\d{1,2}\/\d{1,2}/.test(dateRaw)) continue;
    const cells = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      if (cells[key] === undefined) cells[key] = row[c] != null ? row[c].toString() : '';
    }
    const replies = [];
    if (commentCol !== -1) {
      for (let c = commentCol + 1; c < row.length; c++) {
        if ((header[c] || '').toString().trim()) continue;
        const text = (row[c] || '').toString().trim();
        if (!text) continue;
        const note = (noteRow[c] || '').toString().trim();
        const marker = note.match(/^TUAT_APP_COMMENT:([A-Za-z0-9_-]+)$/);
        replies.push({
          replyIndex: c,
          content: text,
          source: marker ? 'app' : 'sheet',
        });
      }
    }
    records.push({ date: parseSheetDate(dateRaw), cells: cells, replies: replies });
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
function findMemberSheet(memberName) {
  const ss = getSpreadsheet();
  const exact = ss.getSheetByName(memberName);
  if (exact) return exact;
  const normalized = memberName.normalize('NFC').trim();
  const matches = ss.getSheets().filter(sheet => sheet.getName().normalize('NFC').trim() === normalized);
  if (matches.length > 1) throw new Error('同じ名前のシートが複数あります。タブ名を確認してください。');
  return matches[0] || null;
}
function handleFetchMember(memberName) {
  if (!memberName) return createJsonResponse({ error: 'memberName は必須です。' });
  const sheet = findMemberSheet(memberName);
  if (!sheet) return createJsonResponse({ error: 'シート「' + memberName + '」が見つかりません。' });
  const member = readMemberSheet(sheet);
  if (!member) return createJsonResponse({ error: '見出し行（日付）が見つかりません。' });
  return createJsonResponse({ data: member });
}

// 入力セルだけを更新する。送信側のマッピングを信頼して数式を上書きしない。
// This lock coordinates participating handlers in this script only. Google UI
// edits and other scripts are outside this guarantee. Flush before releasing;
// a failed flush is an unconfirmed write, never a successful acknowledgement.
function writeCellsRecord(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const result = writeCellsRecordUnlocked(data);
    SpreadsheetApp.flush();
    return result;
  } finally { lock.releaseLock(); }
}

function writeCellsRecordUnlocked(data) {
  const memberName = data.memberName;
  const date = data.date;
  const cells = data.cells || {};
  if (!memberName || !date) throw new Error('memberName と date は必須です。');

  const sheet = findMemberSheet(memberName);
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
  const protectedHeaders = [];
  // 日付行に式がある距離列を保護する。月間合計の式だけを持つ手入力列は区別する。
  // 既に数式が消された行でも、計算列へ値や空欄を再送しない。
  const formulas = sheet.getDataRange().getFormulas();
  const calculatedDistanceColumns = new Set();
  headerRow.forEach(function (h, col) {
    if (/実際の距離|実距離|走行距離|総距離/.test(normalizeHeaderCell(h))
      && formulas.some(function (row, index) {
        return Boolean(row[col] && values[index] && values[index][0] != null
          && /^\d{4}-\d{2}-\d{2}$/.test(parseSheetDate(values[index][0])));
      })) {
      calculatedDistanceColumns.add(col);
    }
  });
  Object.keys(cells).forEach(function (h) {
    const header = normalizeHeaderCell(h);
    const col = colOf[header];
    if (col === undefined) {
      unmapped.push(h);
      return;
    }
    const cell = sheet.getRange(sheetRowNum, col + 1);
    if (header === '日付' || header === '曜日' || header.indexOf('週合計') !== -1
      || calculatedDistanceColumns.has(col)
      || cell.getFormula()) {
      protectedHeaders.push(h);
      return;
    }
    cell.setValue(cells[h]);
  });

  return {
    success: true,
    action: rowIdx === -1 ? 'created' : 'updated',
    row: sheetRowNum,
    unmapped: unmapped, // 見出しが見つからず書き込めなかった項目（タブに列が無いケースの可視化用）
    protectedHeaders: protectedHeaders,
  };
}

function clearTargetMetadata(sheet, values, hIdx) {
  return {
    contractVersion: CLEAR_CONTRACT_VERSION,
    spreadsheetId: getSpreadsheet().getId(),
    sheetId: sheet.getSheetId().toString(),
    sheetName: sheet.getName(),
    headerRow: hIdx + 1,
    columns: values[hIdx].map(function (label, index) { return { index: index, label: label.toString() }; }),
  };
}

// Metadata only: no record values or notes are returned by this opt-in read.
function readClearTarget(data) {
  if (data.clearContract !== CLEAR_CONTRACT_VERSION || !data.memberName) throw new Error('Clear contract unavailable');
  const sheet = findMemberSheet(data.memberName);
  if (!sheet) throw new Error('Clear target unavailable');
  const values = sheet.getDataRange().getValues();
  const hIdx = findGenericHeaderIndex(values);
  if (hIdx === -1) throw new Error('Clear header unavailable');
  return { clearTarget: clearTargetMetadata(sheet, values, hIdx) };
}

function validClearDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return !isNaN(parsed) && parsed.toISOString().slice(0, 10) === date;
}

function clearIfExistingRecord(data) {
  if (data.contractVersion !== CLEAR_CONTRACT_VERSION || !validClearDate(data.date)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.attemptId || '')
    || !data.memberName || !Array.isArray(data.clearColumns) || !data.clearColumns.length) throw new Error('Invalid clear contract');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = findMemberSheet(data.memberName);
    if (!sheet) throw new Error('Clear target unavailable');
    const values = sheet.getDataRange().getValues();
    const hIdx = findGenericHeaderIndex(values);
    if (hIdx === -1) throw new Error('Clear header unavailable');
    const metadata = clearTargetMetadata(sheet, values, hIdx);
    if (data.spreadsheetId !== metadata.spreadsheetId || data.expectedSheetId !== metadata.sheetId
      || data.expectedSheetName !== metadata.sheetName || data.expectedHeaderRow !== metadata.headerRow
      || JSON.stringify(data.expectedColumns) !== JSON.stringify(metadata.columns)) throw new Error('Clear target changed');
    const dateColumns = metadata.columns.filter(function (column) { return normalizeHeaderCell(column.label) === '日付'; });
    if (dateColumns.length !== 1) throw new Error('Ambiguous clear date column');
    const dateColumn = dateColumns[0].index;
    const rows = [];
    for (let i = hIdx + 1; i < values.length; i++) {
      const raw = values[i][dateColumn];
      if (raw === '' || raw === null || raw === undefined) continue;
      const parsed = parseSheetDate(raw);
      // A malformed date must not become an authoritative missing ACK. Only
      // recognized summary labels can be skipped without understanding a date.
      if (!validClearDate(parsed) && !/^(?:(?:月間|週間|週|月|日)?合計|小計|総計|平均)$/.test(raw.toString().trim()))
        throw new Error('Unrecognized clear date');
      if (parsed === data.date) rows.push(i);
    }
    if (rows.length > 1) throw new Error('Ambiguous clear date row');
    const seen = new Set();
    data.clearColumns.forEach(function (column) {
      if (!column || typeof column.header !== 'string' || !column.header
        || (column.index !== null && (!Number.isInteger(column.index) || column.index < 0
          || !metadata.columns[column.index] || metadata.columns[column.index].label !== column.header))
        || seen.has(column.index === null ? 'missing:' + column.header : column.index)) throw new Error('Invalid clear columns');
      seen.add(column.index === null ? 'missing:' + column.header : column.index);
    });
    const result = { success: true, action: 'clearIfExisting', contractVersion: CLEAR_CONTRACT_VERSION,
      attemptId: data.attemptId, spreadsheetId: metadata.spreadsheetId, sheetId: metadata.sheetId,
      sheetName: metadata.sheetName, date: data.date, outcome: rows.length ? 'cleared' : 'missing',
      row: rows.length ? rows[0] + 1 : null, clearedColumns: [], unmapped: [], protectedHeaders: [] };
    if (rows.length) {
      const formulas = sheet.getDataRange().getFormulas();
      const calculated = new Set();
      metadata.columns.forEach(function (column) {
        if (/実際の距離|実距離|走行距離|総距離/.test(normalizeHeaderCell(column.label))
          && formulas.some(function (row, i) {
            return Boolean(row[column.index] && values[i] && values[i][dateColumn] != null
              && validClearDate(parseSheetDate(values[i][dateColumn])));
          })) calculated.add(column.index);
      });
      data.clearColumns.forEach(function (column) {
        if (column.index === null) { result.unmapped.push(column.header); return; }
        const header = normalizeHeaderCell(column.header);
        const cell = sheet.getRange(result.row, column.index + 1);
        if (header === '日付' || header === '曜日' || header.indexOf('週合計') !== -1
          || calculated.has(column.index) || cell.getFormula()) { result.protectedHeaders.push(column.header); return; }
        cell.setValue('');
        result.clearedColumns.push(column.index);
      });
      if (result.unmapped.length || result.protectedHeaders.length) result.outcome = 'partial';
    }
    SpreadsheetApp.flush();
    return result;
  } finally { lock.releaseLock(); }
}


// ── 中長距離の月別メニュー（E:H = メニュー・ペース・補足・補強）──────────
function writeMiddleLongMenuRecord(data) {
  const date = (data.date || '').toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date は yyyy-MM-dd 形式で必須です。');

  const month = Number(date.slice(5, 7));
  const sheetName = month + '月メニュー';
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('シート「' + sheetName + '」が見つかりません。');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('別の保存処理中です。少し待って再試行してください。');
  try {
    const values = sheet.getDataRange().getValues();
    const targetMonthDay = date.slice(5);
    let rowIdx = -1;
    for (let i = 0; i < values.length; i++) {
      const raw = values[i][0];
      if (!raw) continue;
      const parsed = parseSheetDate(raw);
      if (parsed === date || parsed.slice(5) === targetMonthDay) {
        rowIdx = i;
        break;
      }
    }
    if (rowIdx === -1) throw new Error(date + ' の行が「' + sheetName + '」に見つかりません。');

    const cells = [data.content, data.pace, data.remark, data.supplement].map(function(value) {
      return value == null ? '' : value.toString().trim();
    });
    sheet.getRange(rowIdx + 1, 5, 1, 4).setValues([cells]);
    SpreadsheetApp.flush();
    return { success: true, sheet: sheetName, row: rowIdx + 1 };
  } finally {
    lock.releaseLock();
  }
}
// ── リプライ（旧TFと同じ：感想列より右の「列名なし」列に左から書き足す）─────────
function findHeaderCol(header, keywords) {
  const normalized = header.map(normalizeHeaderCell);
  return normalized.findIndex(function (cell) {
    return keywords.some(function (k) { return cell.indexOf(k) !== -1; });
  });
}

function getCommentColumn(header) {
  const normalized = header.map(normalizeHeaderCell);
  return normalized.findIndex(function (cell) { return cell === '感想'; });
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
    return sheet.getMaxColumns() - 1;
  }
  return nextCol;
}

// payload: { action:'writeReply', memberName, date, text, sourceId? }
function writeReplyRecord(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return writeReplyRecordLocked(data);
  } finally {
    lock.releaseLock();
  }
}

function writeReplyRecordLocked(data) {
  const memberName = data.memberName;
  const date = data.date;
  const text = (data.text || '').toString().trim();
  const sourceId = (data.sourceId || '').toString().replace(/[^A-Za-z0-9_-]/g, '');
  if (!memberName || !date || !text) throw new Error('memberName, date, text は必須です。');

  const sheet = findMemberSheet(memberName);
  if (!sheet) throw new Error('シート「' + memberName + '」が見つかりません。');

  const values = sheet.getDataRange().getValues();
  const hIdx = findGenericHeaderIndex(values);
  if (hIdx === -1) throw new Error('見出し行（日付）が見つかりません。');

  const rowIdx = findRecordRow(values, hIdx, date);
  if (rowIdx === -1) return { success: false, action: 'no_row' };

  const marker = sourceId ? 'TUAT_APP_COMMENT:' + sourceId : '';
  const notes = sheet.getRange(rowIdx + 1, 1, 1, sheet.getMaxColumns()).getNotes()[0];
  if (sourceId && (notes.indexOf('TUAT_DELETED_COMMENT:' + sourceId) >= 0 || notes.some(function(note){return note.indexOf('TUAT_DELETING_COMMENT:' + sourceId + ':') === 0;}))) return { success: false, action: 'deleted' };
  const previous = marker ? notes.indexOf(marker) : -1;
  if (previous >= 0 && values[rowIdx][previous] !== '' && values[rowIdx][previous] != null) {
    return { success: true, action: 'already_replied', row: rowIdx + 1, col: previous + 1 };
  }
  const occupiedRow = notes.map(function (note, col) {
    return (note.indexOf('TUAT_APP_COMMENT:') === 0 || note.indexOf('TUAT_DELETED_COMMENT:') === 0 || note.indexOf('TUAT_DELETED_REPLY:') === 0 || note.indexOf('TUAT_DELETING_') === 0) ? 'reserved' : values[rowIdx][col];
  });
  const col = previous >= 0 ? previous : findNextReplyColumn(sheet, occupiedRow, values[hIdx]);
  const cell = sheet.getRange(rowIdx + 1, col + 1);
  // Reserve the source before writing; a retry can recover an interrupted empty cell.
  if (marker) { cell.setNote(marker); SpreadsheetApp.flush(); }
  cell.setNumberFormat('@');
  cell.setValue("'" + text);
  SpreadsheetApp.flush();
  return { success: true, action: 'replied', row: rowIdx + 1, col: col + 1 };
}

// Clear exactly one reply cell; never shift columns or touch record fields.
function deleteReplyRecord(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!data.memberName || !data.date || !data.deletionId || !data.expectedText) throw new Error('削除対象が不足しています');
    const sheet = findMemberSheet(data.memberName);
    if (!sheet) throw new Error('対象シートが見つかりません');
    const values = sheet.getDataRange().getValues();
    const hIdx = findGenericHeaderIndex(values);
    if (hIdx === -1) throw new Error('見出しが見つかりません');
    const row = findRecordRow(values, hIdx, data.date);
    if (row === -1) return {success:true, action:'no_row'};
    const notes = sheet.getRange(row+1,1,1,sheet.getMaxColumns()).getNotes()[0];
    let sourceId = (data.sourceId || '').toString().replace(/[^A-Za-z0-9_-]/g,'');
    const expected = String(data.expectedText).trim();
    // Older CSV imports lost the app-origin note. An authorized sheet-reply
    // deletion can recover that identity from its exact column and text. Keep
    // the original app ID in the tombstone so delayed app sends stay blocked.
    if (!sourceId && Number.isInteger(data.replyIndex) && data.replyIndex >= 0 && data.replyIndex < notes.length) {
      const candidate = data.replyIndex;
      if (String(values[hIdx][candidate] || '').trim()) throw new Error('返信列ではありません');
      const note = notes[candidate] || '';
      const original = note.match(/^TUAT_APP_COMMENT:([A-Za-z0-9_-]+)$/);
      const completed = note.match(/^TUAT_DELETED_COMMENT:([A-Za-z0-9_-]+)$/);
      const interruptedApp = note.match(/^TUAT_DELETING_COMMENT:([A-Za-z0-9_-]+):(.*)$/);
      if (original) {
        if (String(values[row][candidate] || '').trim() !== expected) throw new Error('返信が変更されています');
        sourceId = original[1];
      } else if (completed) {
        sourceId = completed[1];
      } else if (interruptedApp) {
        if (String(JSON.parse(interruptedApp[2])).trim() !== expected) throw new Error('返信が変更されています');
        sourceId = interruptedApp[1];
      }
    }
    const deleted = (sourceId ? 'TUAT_DELETED_COMMENT:' + sourceId : 'TUAT_DELETED_REPLY:' + data.deletionId);
    const pendingPrefix = (sourceId ? 'TUAT_DELETING_COMMENT:' + sourceId : 'TUAT_DELETING_REPLY:' + data.deletionId) + ':';
    const interrupted = notes.findIndex(function(note){return note.indexOf(pendingPrefix) === 0;});
    if (interrupted >= 0) {
      const original = JSON.parse(notes[interrupted].slice(pendingPrefix.length));
      const current = String(values[row][interrupted] || '');
      if (current && current !== original) throw new Error('削除中に返信が変更されました');
      const cell = sheet.getRange(row+1,interrupted+1);
      cell.clearContent(); cell.setNote(deleted); SpreadsheetApp.flush();
      return {success:true,action:'deleted'};
    }
    const done = notes.indexOf(deleted);
    if (done >= 0) {
      // Retrying a completed deletion must not erase newly typed content.
      if (String(values[row][done] || '').trim()) throw new Error('削除済みの欄に別の返信があります');
      return {success:true,action:'already_deleted'};
    }
    const marker = sourceId ? notes.indexOf('TUAT_APP_COMMENT:' + sourceId) : -1;
    let col = marker;
    if (marker >= 0 && String(values[row][marker] || '').trim() && String(values[row][marker]).trim() !== expected) throw new Error('返信が変更されています');
    if (col < 0 && Number.isInteger(data.replyIndex) && data.replyIndex >= 0 && data.replyIndex < notes.length) {
      const candidate = data.replyIndex;
      if (String(values[hIdx][candidate] || '').trim()) throw new Error('返信列ではありません');
      const value = String(values[row][candidate] || '').trim();
      if (value && value !== expected) throw new Error('返信が変更されています');
      if (notes[candidate] && notes[candidate] !== 'TUAT_APP_COMMENT:' + sourceId) throw new Error('返信の識別情報が一致しません');
      col = candidate;
    }
    if (col < 0 && sourceId) {
      const matches = [];
      values[row].forEach(function(value,index) {
        if (!String(values[hIdx][index] || '').trim() && String(value || '').trim() === expected && !notes[index]) matches.push(index);
      });
      if (matches.length > 1) throw new Error('同じ返信が複数あります');
      if (matches.length === 1) col = matches[0];
      else {
        const occupied = notes.map(function(note,index){return note ? 'reserved' : values[row][index];});
        col = findNextReplyColumn(sheet,occupied,values[hIdx]);
      }
    }
    if (col < 0 || String(values[hIdx][col] || '').trim()) throw new Error('削除対象を特定できません');
    const cell = sheet.getRange(row+1,col+1);
    // Persist the deletion first: a concurrent/retried sender cannot recreate it.
    cell.setNote(pendingPrefix + JSON.stringify(String(values[row][col] || '')));
    SpreadsheetApp.flush();
    cell.clearContent();
    cell.setNote(deleted);
    SpreadsheetApp.flush();
    return {success:true,action:'deleted',col:col+1};
  } finally { lock.releaseLock(); }
}
