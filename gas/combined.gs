/**
 * 旧TFアプリ用GAS ＋ TUAT T&Fアプリ同期API（合体版）
 *
 * これは「旧アプリの既存GASプロジェクト」（公開できている個人アカウントの方）に
 * まるごと貼り替えて使う。旧アプリの既存エンドポイントは一切変えていない。
 * 追加した同期エンドポイント（listMembers / fetchAllRaw / writeCells）にだけ
 * 共有シークレットを掛けてある（旧アプリの呼び出しは secret 不要のまま）。
 *
 * 追加エンドポイント:
 *   GET  ?action=listMembers&secret=...
 *   GET  ?action=fetchAllRaw&secret=...
 *   POST { action:'writeCells', secret, memberName, date, cells:{見出し:値} }
 */

const CACHE_EXPIRATION_SECONDS = 600;
const SHEET_NAME = 'Sheet1';

function getRequiredProperty(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name) || '';
  if (!value) throw new Error(name + ' not set');
  return value;
}
function getSpreadsheet() {
  return SpreadsheetApp.openById(getRequiredProperty('SPREADSHEET_ID'));
}
function getSyncSecret() {
  return getRequiredProperty('SYNC_SECRET');
}
function verifySyncSecret(provided) {
  if ((provided || '').toString() !== getSyncSecret()) throw new Error('unauthorized');
}
function legacyReadsEnabled() {
  return PropertiesService.getScriptProperties().getProperty('LEGACY_READS_ENABLED') === 'true';
}

// 管理用（Web公開はしていない）。通常は単体の sync-api.gs を使用する。
function configurePrivateResources(spreadsheetId, reactionsSpreadsheetId, syncSecret) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', (spreadsheetId || '').toString());
  props.setProperty('REACTIONS_SPREADSHEET_ID', (reactionsSpreadsheetId || '').toString());
  props.setProperty('SYNC_SECRET', (syncSecret || '').toString());
  return 'configured';
}

function doGet(e) {
  try {
    const action = e && e.parameter ? e.parameter.action : '';
    const privateLegacyReads = ['fetchAll', 'fetchLatestRecords', 'fetchPractice', 'getRecord', 'fetchReactions'];
    if (privateLegacyReads.indexOf(action) !== -1 && !legacyReadsEnabled()) {
      return createJsonResponse({ error: 'legacy reads disabled' });
    }

    if (action === 'fetchAll') {
      return handleFetchAll(e.parameter.bypassCache === 'true');
    }
    if (action === 'fetchLatestRecords') {
      return handleFetchLatestRecords(e.parameter.limit, e.parameter.bypassCache === 'true');
    }
    if (action === 'fetchPractice') {
      return handleFetchPractice(e.parameter.month);
    }
    if (action === 'getRecord') {
      return handleGetRecord(e.parameter.memberName, e.parameter.date);
    }
    if (action === 'replySupport') {
      return createJsonResponse({ replySupport: true });
    }
    if (action === 'fetchReactions') {
      return handleFetchReactions();
    }
    // ── 同期API（secret必須）──
    if (action === 'listMembers') {
      verifySyncSecret(e.parameter.secret);
      return handleListMembers();
    }
    if (action === 'fetchAllRaw') {
      verifySyncSecret(e.parameter.secret);
      return handleFetchAllRaw();
    }

    return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('Running Log Form')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    return createJsonResponse({ error: err.toString() }, 500);
  }
}

function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);

    // ── 同期API（旧アプリの投稿には影響しない）──
    if (postData.action === 'writeCells') {
      verifySyncSecret(postData.secret);
      return createJsonResponse(writeCellsRecord(postData));
    }

    const result = postData.action === 'addReply'
      ? addPracticeReply(postData)
      : postData.action === 'toggleReaction'
        ? togglePracticeReaction(postData)
        : writePracticeRecord(postData);

    const cache = CacheService.getScriptCache();
    cache.remove('all_member_stats');
    cache.remove('latest_records_30');
    return createJsonResponse(result);
  } catch (err) {
    return createJsonResponse({ error: err.toString() }, 500);
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function createJsonResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function submitData(data) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
    const row = [
      data.date,
      data.day,
      data.targetDist,
      data.actualDist,
      data.weeklyTotal,
      data.result,
      data.jog,
      data.jogTotal,
      data.mlt,
      data.mltTotal,
      data.cvvo2,
      data.cvvo2Total,
      data.speed,
      data.speedTotal,
      data.strides,
      data.otherEx,
      data.weights,
      data.comment,
      data.condition,
      data.sleep
    ];
    sheet.appendRow(row);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function normalizeHeaderCell(cell) {
  return cell.toString().replace(/\s+/g, '').trim();
}

function findHeaderCol(header, keywords) {
  const normalized = header.map(normalizeHeaderCell);
  return normalized.findIndex(cell => keywords.some(keyword => cell.indexOf(keyword) !== -1));
}

function findHeaderIndex(values) {
  for (let i = 0; i < Math.min(15, values.length); i++) {
    if (values[i].some(cell => cell.toString().indexOf('低強度') !== -1)) {
      return i;
    }
  }
  return -1;
}

// 「日付」を含む行を見出し行とみなす（同期用・短距離など低強度が無いシートにも対応）
function findGenericHeaderIndex(values) {
  for (let i = 0; i < Math.min(15, values.length); i++) {
    if (values[i].some(cell => normalizeHeaderCell(cell) === '日付')) return i;
  }
  return -1;
}

function getColumns(header) {
  const columns = {
    dateCol: 0,
    jogCol: findHeaderCol(header, ['低強度']),
    mltCol: findHeaderCol(header, ['中強度']),
    cvCol: findHeaderCol(header, ['高強度']),
    speedCol: findHeaderCol(header, ['解糖系']),
    stridesCol: findHeaderCol(header, ['流し']),
    reinforceCol: findHeaderCol(header, ['補強']),
    commentCol: findHeaderCol(header, ['感想', 'コメント', '反省', '状態']),
    resultCol: findHeaderCol(header, ['結果', 'ペース'])
  };

  columns.totalCol = findHeaderCol(header, ['実際の距離']);
  if (columns.totalCol === -1) {
    const normalized = header.map(normalizeHeaderCell);
    columns.totalCol = normalized.findIndex(cell => cell === '距離');
  }

  return columns;
}

function findRecordRow(values, headerIdx, date) {
  for (let i = headerIdx + 1; i < values.length; i++) {
    const raw = values[i][0];
    if (!raw) continue;
    if (parseSheetDate(raw) === date) return i;
  }
  return -1;
}

function handleFetchAll(bypassCache) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'all_member_stats';

  if (!bypassCache) {
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return createJsonResponse({ source: 'cache', data: JSON.parse(cachedData) });
    }
  }

  const allData = [];
  const sheets = getSpreadsheet().getSheets();
  for (const sheet of sheets) {
    const name = sheet.getName();
    if (/^[BM]\d/.test(name)) {
      const records = parseMemberSheet(sheet);
      if (records !== null) {
        allData.push({
          name,
          gid: sheet.getSheetId().toString(),
          records
        });
      }
    }
  }

  const sortedData = allData.sort((a, b) => a.name.localeCompare(b.name));
  try {
    cache.put(cacheKey, JSON.stringify(sortedData), CACHE_EXPIRATION_SECONDS);
  } catch (err) {
    Logger.log('キャッシュ保存失敗: ' + err.toString());
  }

  return createJsonResponse({ source: 'sheets', data: sortedData });
}

function handleFetchLatestRecords(limitParam, bypassCache) {
  const limit = Math.max(1, Math.min(parseInt(limitParam || '30', 10) || 30, 100));
  const cache = CacheService.getScriptCache();
  const cacheKey = 'latest_records_' + limit;

  if (!bypassCache) {
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return createJsonResponse({ source: 'cache', data: JSON.parse(cachedData) });
    }
  }

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const latest = [];
  const sheets = getSpreadsheet().getSheets();
  for (const sheet of sheets) {
    const name = sheet.getName();
    if (!/^[BM]\d/.test(name)) continue;

    const records = parseMemberSheet(sheet);
    if (!records) continue;

    records.forEach(record => {
      if (record.date && record.date <= today) {
        latest.push({
          ...record,
          memberName: name
        });
      }
    });
  }

  const data = latest
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);

  try {
    cache.put(cacheKey, JSON.stringify(data), CACHE_EXPIRATION_SECONDS);
  } catch (err) {
    Logger.log('最近記録キャッシュ保存失敗: ' + err.toString());
  }

  return createJsonResponse({ source: 'sheets', data });
}

function handleFetchPractice(month) {
  if (!month) {
    return createJsonResponse({ error: 'month is required' });
  }

  const rawMonthLabel = month.toString().trim().replace(/メニュー$/, '');
  const monthLabel = rawMonthLabel.endsWith('月') ? rawMonthLabel : rawMonthLabel + '月';
  const sheet = getSpreadsheet().getSheetByName(monthLabel + 'メニュー');
  if (!sheet) {
    return createJsonResponse({ data: [] });
  }

  const values = sheet.getDataRange().getDisplayValues();
  const dataStart = values.findIndex(row => /^\d{1,4}\/\d{1,2}/.test((row[0] || '').toString().trim()));
  const dataRows = dataStart >= 0 ? values.slice(dataStart) : values.slice(4);

  const records = dataRows
    .filter(row => {
      const dateVal = (row[0] || '').toString().trim();
      const location = (row[3] || '').toString().trim();
      const menu = (row[4] || '').toString().trim();
      return dateVal && (location || menu);
    })
    .map((row, i) => ({
      id: i + 1,
      date: parseSheetDate(row[0] || ''),
      dayOfWeek: (row[1] || '').toString().trim(),
      time: formatTime(row[2] || ''),
      location: (row[3] || '').toString().trim(),
      weather: '',
      menu: (row[4] || '').toString().replace(/\\n/g, '\n'),
      pace: (row[5] || '').toString().replace(/\\n/g, '\n'),
      notes: (row[6] || '').toString().replace(/\\n/g, '\n')
    }));

  return createJsonResponse({ data: records });
}

function handleGetRecord(memberName, date) {
  if (!memberName || !date) {
    return createJsonResponse({ exists: false, error: 'memberName と date は必須です。' });
  }

  const sheet = getSpreadsheet().getSheetByName(memberName);
  if (!sheet) {
    return createJsonResponse({ exists: false });
  }

  const values = sheet.getDataRange().getValues();
  const headerIdx = findHeaderIndex(values);
  if (headerIdx === -1) {
    return createJsonResponse({ exists: false });
  }

  const columns = getColumns(values[headerIdx]);
  const targetRowIdx = findRecordRow(values, headerIdx, date);
  if (targetRowIdx === -1) {
    return createJsonResponse({ exists: false });
  }

  const row = values[targetRowIdx];
  const parseNum = (val) => {
    if (val === undefined || val === null || val === '') return 0;
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  };

  return createJsonResponse({
    exists: true,
    data: {
      jog: columns.jogCol !== -1 ? parseNum(row[columns.jogCol]) : 0,
      mlt: columns.mltCol !== -1 ? parseNum(row[columns.mltCol]) : 0,
      cv: columns.cvCol !== -1 ? parseNum(row[columns.cvCol]) : 0,
      speed: columns.speedCol !== -1 ? parseNum(row[columns.speedCol]) : 0,
      strides: columns.stridesCol !== -1 ? parseNum(row[columns.stridesCol]) : 0,
      reinforce: columns.reinforceCol !== -1 ? row[columns.reinforceCol].toString().trim() : '',
      comment: columns.commentCol !== -1 ? row[columns.commentCol].toString().trim() : '',
      result: columns.resultCol !== -1 ? row[columns.resultCol].toString().trim() : ''
    }
  });
}

function parseMemberSheet(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 15) return null;

  const headerIdx = findHeaderIndex(values);
  if (headerIdx === -1) return null;

  const header = values[headerIdx];
  const columns = getColumns(header);
  const records = [];

  for (const row of values.slice(headerIdx + 1)) {
    const dateRaw = row[0] ? row[0].toString().trim() : '';
    if (!dateRaw || !/^\d{1,2}\/\d{1,2}/.test(dateRaw)) continue;

    const jog = columns.jogCol !== -1 ? parseDistance(row[columns.jogCol]) : 0;
    const mlt = columns.mltCol !== -1 ? parseDistance(row[columns.mltCol]) : 0;
    const cv = columns.cvCol !== -1 ? parseDistance(row[columns.cvCol]) : 0;
    const speed = columns.speedCol !== -1 ? parseDistance(row[columns.speedCol]) : 0;
    const actual = columns.totalCol !== -1 ? parseDistance(row[columns.totalCol]) : 0;
    const strides = columns.stridesCol !== -1 ? parseDistance(row[columns.stridesCol]) : 0;
    const reinforce = columns.reinforceCol !== -1 ? row[columns.reinforceCol].toString().trim() : '';
    const comment = columns.commentCol !== -1 ? row[columns.commentCol].toString().trim() : '';
    const result = columns.resultCol !== -1 ? row[columns.resultCol].toString().trim() : '';
    const replies = readPracticeReplies(row, header);

    const sum = jog + mlt + cv + speed;
    const total = sum > 0 ? Math.max(sum, actual) : actual;

    if (total > 0 || jog > 0 || mlt > 0 || cv > 0 || speed > 0 || strides > 0 || reinforce || comment || result || replies.length > 0) {
      records.push({
        date: parseSheetDate(dateRaw),
        total: round2(total),
        jog: round2(jog),
        mlt: round2(mlt),
        cv: round2(cv),
        speed: round2(speed),
        strides: round2(strides),
        reinforce,
        comment,
        result,
        replies
      });
    }
  }

  return records;
}

function writePracticeRecord(data) {
  const { memberName, date, jog, mlt, cv, speed, strides, reinforce, comment, result, total, isDelete } = data;
  if (!memberName || !date) {
    throw new Error('メンバー名と日付は必須です。');
  }

  const sheet = getSpreadsheet().getSheetByName(memberName);
  if (!sheet) {
    throw new Error('シート「' + memberName + '」が見つかりません。');
  }

  const values = sheet.getDataRange().getValues();
  const headerIdx = findHeaderIndex(values);
  if (headerIdx === -1) {
    throw new Error('シートのデータ形式（低強度列）が見つかりません。');
  }

  const columns = getColumns(values[headerIdx]);
  let rowToUpdate = findRecordRow(values, headerIdx, date);
  const formatCellVal = (val) => (val !== undefined && val !== null && val !== '') ? parseFloat(val) : '';

  if (isDelete) {
    if (rowToUpdate === -1) return { success: true, action: 'not_found' };
    rowToUpdate += 1;
    [
      columns.jogCol,
      columns.mltCol,
      columns.cvCol,
      columns.speedCol,
      columns.stridesCol,
      columns.reinforceCol,
      columns.commentCol,
      columns.resultCol
    ].filter(col => col !== -1).forEach(col => {
      sheet.getRange(rowToUpdate, col + 1).setValue('');
    });
    return { success: true, action: 'deleted', row: rowToUpdate };
  }

  if (rowToUpdate === -1) {
    rowToUpdate = sheet.getLastRow();
    sheet.insertRowAfter(rowToUpdate);
    rowToUpdate += 1;
    const targetDate = new Date(date);
    sheet.getRange(rowToUpdate, 1).setValue((targetDate.getMonth() + 1) + '/' + targetDate.getDate());
    sheet.getRange(rowToUpdate, 2).setValue(['日', '月', '火', '水', '木', '金', '土'][targetDate.getDay()]);
  } else {
    rowToUpdate += 1;
  }

  if (columns.jogCol !== -1) sheet.getRange(rowToUpdate, columns.jogCol + 1).setValue(formatCellVal(jog));
  if (columns.mltCol !== -1) sheet.getRange(rowToUpdate, columns.mltCol + 1).setValue(formatCellVal(mlt));
  if (columns.cvCol !== -1) sheet.getRange(rowToUpdate, columns.cvCol + 1).setValue(formatCellVal(cv));
  if (columns.speedCol !== -1) sheet.getRange(rowToUpdate, columns.speedCol + 1).setValue(formatCellVal(speed));
  if (columns.stridesCol !== -1) sheet.getRange(rowToUpdate, columns.stridesCol + 1).setValue(formatCellVal(strides));
  if (columns.reinforceCol !== -1) sheet.getRange(rowToUpdate, columns.reinforceCol + 1).setValue(reinforce || '');
  if (columns.commentCol !== -1) sheet.getRange(rowToUpdate, columns.commentCol + 1).setValue(comment || '');
  if (columns.resultCol !== -1) sheet.getRange(rowToUpdate, columns.resultCol + 1).setValue(result || '');

  if (columns.totalCol !== -1 && total !== undefined && total !== null && total !== '') {
    const cell = sheet.getRange(rowToUpdate, columns.totalCol + 1);
    if (!cell.getFormula()) {
      cell.setValue(parseFloat(total));
    }
  }

  return { success: true, action: 'updated', row: rowToUpdate };
}

function addPracticeReply(data) {
  const { memberName, date, reply } = data;
  if (!memberName || !date || !reply || !reply.toString().trim()) {
    throw new Error('メンバー名、日付、リプライは必須です。');
  }

  const sheet = getSpreadsheet().getSheetByName(memberName);
  if (!sheet) {
    throw new Error('シート「' + memberName + '」が見つかりません。');
  }

  const values = sheet.getDataRange().getValues();
  const headerIdx = findHeaderIndex(values);
  if (headerIdx === -1) {
    throw new Error('シートのデータ形式（低強度列）が見つかりません。');
  }

  const rowIdx = findRecordRow(values, headerIdx, date);
  if (rowIdx === -1) {
    throw new Error('対象日の記録が見つかりません。先に練習記録を作成してください。');
  }

  const header = values[headerIdx];
  const targetRow = values[rowIdx];
  const targetCol = findNextReplyColumn(sheet, targetRow, header);
  sheet.getRange(rowIdx + 1, targetCol + 1).setValue(reply.toString().trim());

  return { success: true, action: 'replied', row: rowIdx + 1, col: targetCol + 1 };
}

function getReactionsSpreadsheet() {
  return SpreadsheetApp.openById(getRequiredProperty('REACTIONS_SPREADSHEET_ID'));
}

function getReactionSheetName(date) {
  const parsed = new Date(date);
  if (!isNaN(parsed)) {
    return (parsed.getMonth() + 1) + '月';
  }
  const match = date.toString().match(/-(\d{2})-/);
  if (match) {
    return parseInt(match[1], 10) + '月';
  }
  return 'その他';
}

function getOrCreateReactionSheet(date) {
  const ss = getReactionsSpreadsheet();
  const sheetName = getReactionSheetName(date);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['createdAt', 'targetKey', 'targetMember', 'targetDate', 'type', 'actorId']);
  }

  return sheet;
}

function makeTargetKey(memberName, date) {
  return memberName + '__' + date;
}

function handleFetchReactions() {
  const ss = getReactionsSpreadsheet();
  const rows = [];

  ss.getSheets().forEach(sheet => {
    const values = sheet.getDataRange().getDisplayValues();
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const targetKey = row[1] || makeTargetKey(row[2], row[3]);
      const type = row[4];
      const actorId = row[5];
      if (!targetKey || !type) continue;
      rows.push({
        createdAt: row[0],
        targetKey,
        targetMember: row[2],
        targetDate: row[3],
        type,
        actorId
      });
    }
  });

  return createJsonResponse({ reactions: rows });
}

function togglePracticeReaction(data) {
  const { memberName, date, type, actorId } = data;
  if (!memberName || !date || !type || !actorId) {
    throw new Error('memberName, date, type, actorId は必須です。');
  }

  const targetKey = makeTargetKey(memberName, date);
  const sheet = getOrCreateReactionSheet(date);

  sheet.appendRow([
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
    targetKey,
    memberName,
    date,
    type,
    actorId
  ]);

  return { success: true, action: 'added', targetKey, type };
}

function getCommentColumn(header) {
  return findHeaderCol(header, ['感想', 'コメント', '反省', '状態']);
}

function readPracticeReplies(row, header) {
  const replies = [];
  const commentCol = getCommentColumn(header);
  const startCol = commentCol !== -1 ? commentCol + 1 : header.length;

  for (let col = startCol; col < row.length; col++) {
    const headerText = (header[col] || '').toString().trim();
    if (headerText) continue;
    const text = row[col] ? row[col].toString().trim() : '';
    if (text) replies.push(text);
  }

  return replies;
}

function findNextReplyColumn(sheet, row, header) {
  const commentCol = getCommentColumn(header);
  const startCol = commentCol !== -1 ? commentCol + 1 : header.length;
  let rightmostReplyCol = startCol - 1;

  for (let col = startCol; col < sheet.getMaxColumns(); col++) {
    const headerText = (header[col] || '').toString().trim();
    if (headerText) continue;
    if ((row[col] || '').toString().trim() !== '') {
      rightmostReplyCol = col;
    }
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

function parseDistance(val) {
  if (!val) return 0;

  let cleanVal = val.toString().trim().replace(/[０-９．＋，、（）]/g, (s) => {
    if (s === '．') return '.';
    if (s === '＋') return '+';
    if (s === '，' || s === '、') return ',';
    if (s === '（') return '(';
    if (s === '）') return ')';
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  });

  while (cleanVal.indexOf('(') !== -1) {
    const start = cleanVal.indexOf('(');
    const end = cleanVal.indexOf(')', start);
    cleanVal = end !== -1
      ? cleanVal.substring(0, start) + cleanVal.substring(end + 1)
      : cleanVal.substring(0, start);
  }

  return cleanVal.split(/[+,]/).reduce((sum, part) => {
    const num = parseFloat(part.trim().replace(/[^\d.]/g, ''));
    return sum + (isNaN(num) ? 0 : num);
  }, 0);
}

function formatTime(raw) {
  if (!raw) return '';
  return raw.toString().trim().replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1');
}

function round2(num) {
  return Math.round(num * 100) / 100;
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
  if (parts.length === 2) {
    return year + '-' + parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0');
  }
  if (parts.length === 3) {
    return parts[0] + '-' + parts[1].padStart(2, '0') + '-' + parts[2].padStart(2, '0');
  }
  return s;
}

// ════════════════════════════════════════════════════════════════════
// ここから下が TUAT T&F アプリ同期API（追加分）
// ════════════════════════════════════════════════════════════════════

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
    if (col === undefined) return;
    sheet.getRange(sheetRowNum, col + 1).setValue(cells[h]);
  });

  return { success: true, action: rowIdx === -1 ? 'created' : 'updated', row: sheetRowNum };
}
