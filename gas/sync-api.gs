/**
 * TUAT T&F アプリ専用の同期API（Google Apps Script・スタンドアロン）
 *
 * 旧TFアプリ(D:\AI\Antigravity\TF)のGASとは別物。
 * これは新しいApps Scriptプロジェクトを作って貼り付け、別の URL でデプロイする。
 * これにより旧アプリのGASは一切変えずに済む。
 *
 * 使い方:
 *   1) script.google.com で新規プロジェクト作成 → このコードを貼る
 *   2) 下の SYNC_SECRET に好きな秘密文字列を設定（Vercelの SHEET_SYNC_SECRET と同じ値）
 *   3) デプロイ → ウェブアプリ（実行=自分 / アクセス=全員）→ /exec URL を控える
 *   4) Vercel: SHEET_SYNC_GAS_URL=その/exec URL, SHEET_SYNC_SECRET=同じ秘密
 *
 * エンドポイント:
 *   GET  ?action=listMembers&secret=...           部員シート名一覧
 *   GET  ?action=fetchAllRaw&secret=...            全部員の見出し+生データ
 *   POST { action:'writeCells', secret, memberName, date, cells:{見出し:値} }
 */

const SPREADSHEET_ID = '1uAo7E8_rMbUZlml1H0vj119htQeoa2eMWqASUXQTqgg';
// ★ここを設定（Vercelの SHEET_SYNC_SECRET と完全に同じ値にする）
const SYNC_SECRET = 'PUT-YOUR-SECRET-HERE';

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function verifySyncSecret(provided) {
  if (!SYNC_SECRET || SYNC_SECRET === 'PUT-YOUR-SECRET-HERE') {
    throw new Error('SYNC_SECRET is not configured');
  }
  if ((provided || '').toString() !== SYNC_SECRET) {
    throw new Error('unauthorized');
  }
}

function createJsonResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    verifySyncSecret(p.secret);
    if (p.action === 'listMembers') return handleListMembers();
    if (p.action === 'fetchAllRaw') return handleFetchAllRaw();
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
    return createJsonResponse({ error: 'unknown action' });
  } catch (err) {
    return createJsonResponse({ error: err.toString() });
  }
}

// ── ヘルパー ──────────────────────────────────────────────────────────────────
function normalizeHeaderCell(cell) {
  return cell.toString().replace(/\s+/g, '').trim();
}

// 「日付」を含む行を見出し行とみなす（中長距離=1行目／短距離=2行目 どちらも対応）
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

// ── エンドポイント実装 ────────────────────────────────────────────────────────
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

function handleFetchAllRaw() {
  const out = [];
  const sheets = getSpreadsheet().getSheets();
  for (const sheet of sheets) {
    const name = sheet.getName();
    if (!/^[BM]\d/.test(name)) continue;

    const values = sheet.getDataRange().getDisplayValues();
    const hIdx = findGenericHeaderIndex(values);
    if (hIdx === -1) continue;

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
    out.push({ name: name, gid: sheet.getSheetId().toString(), header: header.filter(Boolean), records: records });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return createJsonResponse({ data: out });
}

// 見出し名でセルを upsert（実際の距離などの数式列は触らない＝マップ対象だけ書く）
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

  Object.keys(cells).forEach(function (h) {
    const col = colOf[normalizeHeaderCell(h)];
    if (col === undefined) return; // 該当列なし=スキップ（列は勝手に増やさない）
    sheet.getRange(sheetRowNum, col + 1).setValue(cells[h]);
  });

  return { success: true, action: rowIdx === -1 ? 'created' : 'updated', row: sheetRowNum };
}
