// Standalone private project. Never bind this script to the link-shared workbook.
// One-way app to workbook output. Credentials and row identities stay private.
var OB_RESULTS_TARGET = '188DwdYDpRuk4a27whOiu5lhhNK4MDaSeYRfXTHDhBAw';
var OB_RESULTS_FEED_URL = 'https://tuat-tf.vercel.app/api/ob-results/snapshot';
var OB_EDIT_NAME = 'エントリー編集';
var OB_EDIT_METADATA_KEY = 'TUAT_OB_EDIT_MANAGED_V1';
var OB_RESULTS_STATUS_OPTIONS = ['出場', 'DNS（欠場）', 'DNF（途中棄権）', 'DQ（失格）'];
var OB_RESULTS_METADATA_KEY = 'TUAT_OB_RESULTS_MANAGED_V1';
var OB_RESULTS_TABS = ['プログラム', '1500m', 'ジャベリックスロー', '立ち五段跳び', '100m', '砲丸投げ', '300mH', '走り高跳び', '300m', 'やり投げ', '走り幅跳び', '3000m'];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Public entrypoint in the Apps Script editor.
function dryRunObResultsPublish() { return runObResultsPublish_(true); }
function publishObResults() { return runObResultsPublish_(false); }

/** One-time owner action: authorize, validate the source, publish, then start this one trigger. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Public entrypoint in the Apps Script editor.
function initializeObPublisher() {
  var properties = PropertiesService.getScriptProperties();
  if (typeof OB_RESULTS_BOOTSTRAP !== 'undefined') {
    if (!OB_RESULTS_BOOTSTRAP || !/^[a-f0-9]{64}$/.test(OB_RESULTS_BOOTSTRAP.readToken || '')
        || !Array.isArray(OB_RESULTS_BOOTSTRAP.initialRanges) || OB_RESULTS_BOOTSTRAP.initialRanges.length !== OB_RESULTS_TABS.length) throw new Error('Invalid private OB setup');
    properties.setProperties({ OB_RESULTS_READ_TOKEN: OB_RESULTS_BOOTSTRAP.readToken, OB_RESULTS_INITIAL_RANGES: JSON.stringify(OB_RESULTS_BOOTSTRAP.initialRanges) });
    if (OB_RESULTS_BOOTSTRAP.writeToken) properties.setProperty('OB_RESULTS_WRITE_TOKEN', OB_RESULTS_BOOTSTRAP.writeToken);
  }
  var result = publishObResults();
  installObResultsTrigger();
  return result;
}

function runObResultsPublish_(dryRun) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { var busy = new Error('OB output is already running'); busy.obBusy = true; throw busy; }
  try {
    var properties = PropertiesService.getScriptProperties();
    var token = properties.getProperty('OB_RESULTS_READ_TOKEN');
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('OB read-only token is not configured');
    var response = UrlFetchApp.fetch(OB_RESULTS_FEED_URL, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: false });
    if (response.getResponseCode() !== 200) throw new Error('OB source unavailable; previous sheet preserved');
    var snapshot = JSON.parse(response.getContentText());
    validateObResultsSnapshot_(snapshot);
    var workbook = Sheets.Spreadsheets.get(OB_RESULTS_TARGET, { fields: 'sheets.properties,developerMetadata' });
    var state = readObStatusState_(properties);
    var marker = (workbook.developerMetadata || []).filter(function(item) { return item.metadataKey === OB_RESULTS_METADATA_KEY; });
    var revision = marker.length === 1 ? JSON.parse(marker[0].metadataValue).revision : null;
    // Recover the baseline of an atomic Sheets batch whose response was lost.
    if (state && state.next) state = { baseline: revision === state.next.revision ? state.next : state.baseline, pending: state.pending || null };
    // One-way output: never read or submit user edits to the app.
    if (state && state.pending) { state.pending = null; writeObStatusState_(properties, state); }
    var initial = properties.getProperty('OB_RESULTS_INITIAL_RANGES');
    snapshot = obReadOnlySnapshot_(snapshot);
    var plan = buildObResultsPlan_(snapshot, workbook, initial ? JSON.parse(initial) : null);
    appendObDirectRetirement_(plan, workbook, state && state.baseline);
    // The revision and generated bounds are saved in the SAME atomic batch as the cells.
    // After an ambiguous response, the next run reads that marker instead of replaying inserts.
    if (!dryRun && plan.requests.length) {
      var next = { revision: snapshot.revision, sheets: snapshot.sheets, outputVersion: 1 };
      writeObStatusState_(properties, { baseline: state ? state.baseline : null, next: next });
      Sheets.Spreadsheets.batchUpdate({ requests: plan.requests }, OB_RESULTS_TARGET);
      writeObStatusState_(properties, { baseline: next });
    } else if (!dryRun && snapshot.statusTargets && (!state || !state.baseline)) {
      throw new Error('OB status baseline is missing; do not adopt potentially edited rows');
    }
    return { dryRun: dryRun, changed: plan.requests.length > 0, entryCount: snapshot.entryCount,
      revision: snapshot.revision, sourceTimeJst: Utilities.formatDate(new Date(snapshot.generatedAt), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'), changes: plan.changes };
  } finally { lock.releaseLock(); }
}

function validateObResultsSnapshot_(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 2 || snapshot.meetKey !== 'ob-2026' || snapshot.spreadsheetId !== OB_RESULTS_TARGET
      || !/^[a-f0-9]{64}$/.test(snapshot.revision || '') || !Number.isSafeInteger(snapshot.entryCount) || snapshot.entryCount < 0
      || typeof snapshot.generatedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.generatedAt))
      || !Array.isArray(snapshot.sheets) || snapshot.sheets.length !== OB_RESULTS_TABS.length) throw new Error('Invalid OB source; previous sheet preserved');
  snapshot.sheets.forEach(function(sheet, index) {
    if (!sheet || sheet.name !== OB_RESULTS_TABS[index] || !Array.isArray(sheet.widths) || !sheet.widths.length
        || !sheet.widths.every(function(width) { return Number.isFinite(width) && width > 0; })
        || !Array.isArray(sheet.rows) || !sheet.rows.length || sheet.rows[0].length !== sheet.widths.length) throw new Error('Invalid OB tab');
    sheet.rows.forEach(function(row) {
      if (!Array.isArray(row) || row.length > sheet.widths.length || !row.every(function(cell) {
        return cell === null || typeof cell === 'string' || (typeof cell === 'number' && Number.isFinite(cell));
      })) throw new Error('Invalid OB cells');
    });
    if (index === 0 && JSON.stringify(sheet.rows[0]) !== JSON.stringify(['時刻', '内容', '備考'])) throw new Error('Invalid OB program');
    if (index > 0 && ['区分', '氏名', '学年', '出場状況', '記録'].some(function(header) { return sheet.rows[0].indexOf(header) < 0; })) throw new Error('Missing OB headers');
  });
  if (!Array.isArray(snapshot.statusTargets) || snapshot.statusTargets.length !== 11) throw new Error('Missing OB private row mapping');
  snapshot.statusTargets.forEach(function(tab, index) {
    var sheet = snapshot.sheets[index + 1];
    if (!tab || tab.name !== sheet.name || tab.statusColumn !== sheet.rows[0].indexOf('出場状況') || !Array.isArray(tab.rows)) throw new Error('Invalid OB status mapping');
    var seen = {};
    tab.rows.forEach(function(row) {
      if (!Number.isSafeInteger(row.row) || row.row < 1 || row.row >= sheet.rows.length || seen[row.row]
          || !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(row.token || '') || OB_RESULTS_STATUS_OPTIONS.indexOf(sheet.rows[row.row][tab.statusColumn]) < 0) throw new Error('Invalid OB status row');
      seen[row.row] = true;
    });
  });
}

function buildObResultsPlan_(snapshot, workbook, initialRanges) {
  validateObResultsSnapshot_(snapshot);
  var metadata = (workbook.developerMetadata || []).filter(function(item) { return item.metadataKey === OB_RESULTS_METADATA_KEY; });
  if (metadata.length > 1) throw new Error('Duplicate OB output marker');
  var previous = metadata.length ? JSON.parse(metadata[0].metadataValue) : null;
  if (previous && (previous.version !== 1 || previous.meetKey !== 'ob-2026')) throw new Error('Invalid OB output marker');
  var managed = previous ? previous.managed : initialRanges;
  if (!Array.isArray(managed) || managed.length !== OB_RESULTS_TABS.length) throw new Error('Initial generated ranges must be reviewed before the first write');
  var mapped = snapshot.sheets.map(function(source) {
    var matches = (workbook.sheets || []).filter(function(sheet) { return sheet.properties.title === source.name; });
    if (matches.length !== 1) throw new Error('An OB output tab is missing or renamed');
    var target = matches[0].properties;
    var bounds = managed.filter(function(item) { return item.sheetId === target.sheetId; });
    if (bounds.length !== 1 || !Number.isSafeInteger(bounds[0].rows) || bounds[0].rows < 1
        || !Number.isSafeInteger(bounds[0].columns) || bounds[0].columns < 1
        || bounds[0].rows > target.gridProperties.rowCount || bounds[0].columns > target.gridProperties.columnCount) throw new Error('Invalid generated range');
    var boundsNow = Object.assign({}, bounds[0]);
    return { source: source, target: target, bounds: boundsNow };
  });
  if (snapshot.entryCount === 0 && mapped.some(function(item, index) { return index > 0 && item.bounds.rows > 1; })) throw new Error('Refusing to replace an existing roster with zero entries');
  if (previous && previous.revision === snapshot.revision) return { requests: [], changes: [] };
  var requests = [], changes = [], nextManaged = [];
  mapped.forEach(function(item) {
    var source = item.source, target = item.target, before = item.bounds;
    var rows = source.rows.length, columns = source.widths.length;
    // Insert at the end of the generated area. Existing independent notes below/right move intact.
    [['ROWS', rows, before.rows, target.gridProperties.rowCount], ['COLUMNS', columns, before.columns, target.gridProperties.columnCount]].forEach(function(dimension) {
      if (dimension[1] > dimension[3]) requests.push({ appendDimension: { sheetId: target.sheetId, dimension: dimension[0], length: dimension[1] - dimension[3] } });
      if (dimension[1] > dimension[2]) requests.push({ insertDimension: { range: { sheetId: target.sheetId, dimension: dimension[0], startIndex: dimension[2], endIndex: dimension[1] }, inheritFromBefore: true } });
    });
    var managedColumns = Math.max(columns, before.columns), managedRows = Math.max(rows, before.rows);
    var cells = Array.from({ length: managedRows }, function(_, row) { return { values: Array.from({ length: managedColumns }, function(_, column) { return obResultsCell_(source.rows[row] && source.rows[row][column]); }) }; });
    requests.push({ updateCells: { range: { sheetId: target.sheetId, startRowIndex: 0, endRowIndex: managedRows, startColumnIndex: 0, endColumnIndex: managedColumns },
      rows: cells, fields: 'userEnteredValue' } });
    // Remove obsolete rules only inside our generated area; blank/cancelled rows are not selectable.
    requests.push({ setDataValidation: { range: { sheetId: target.sheetId, startRowIndex: 0, endRowIndex: managedRows, startColumnIndex: 0, endColumnIndex: managedColumns } } });
    requests.push({ repeatCell: { range: { sheetId: target.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columns }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
    requests.push({ updateSheetProperties: { properties: { sheetId: target.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
    source.widths.forEach(function(width, index) { requests.push({ updateDimensionProperties: { range: { sheetId: target.sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 }, properties: { pixelSize: Math.round(width * 7 + 16) }, fields: 'pixelSize' } }); });
    nextManaged.push({ sheetId: target.sheetId, rows: rows, columns: managedColumns });
    changes.push({ tab: source.name, oldRows: before.rows, rows: rows, oldColumns: before.columns, columns: columns });
  });
  var next = JSON.stringify({ version: 1, meetKey: 'ob-2026', revision: snapshot.revision, generatedAt: snapshot.generatedAt, managed: nextManaged });
  if (metadata.length) requests.push({ updateDeveloperMetadata: { dataFilters: [{ developerMetadataLookup: { metadataId: metadata[0].metadataId } }], developerMetadata: { metadataValue: next }, fields: 'metadataValue' } });
  else requests.push({ createDeveloperMetadata: { developerMetadata: { metadataKey: OB_RESULTS_METADATA_KEY, metadataValue: next, location: { spreadsheet: true }, visibility: 'DOCUMENT' } } });
  return { requests: requests, changes: changes };
}

function obResultsCell_(cell) {
  // Explicit stringValue preserves names/marks beginning with '=' as literal text.
  return cell === undefined || cell === null || cell === '' ? {} : { userEnteredValue: typeof cell === 'number' ? { numberValue: cell } : { stringValue: cell } };
}

function obReadOnlySnapshot_(snapshot) {
  var copy = JSON.parse(JSON.stringify(snapshot));
  copy.revision = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'ob-output-v1:' + snapshot.revision)
    .map(function(n) { return ('0' + ((n + 256) % 256).toString(16)).slice(-2); }).join('');
  return copy;
}

function appendObDirectRetirement_(plan, workbook, baseline) {
  var editor = workbook.sheets.filter(function(s) { return s.properties.title === OB_EDIT_NAME; });
  if (!editor.length) return;
  var markers = (workbook.developerMetadata || []).filter(function(m) { return m.metadataKey === OB_EDIT_METADATA_KEY; });
  if (editor.length !== 1 || markers.length !== 1 || !baseline || !baseline.editSheet) throw new Error('OB legacy editor retirement is not verified; input preserved');
  plan.requests.push({ deleteSheet: { sheetId: editor[0].properties.sheetId } });
  plan.requests.push({ deleteDeveloperMetadata: { dataFilter: { developerMetadataLookup: { metadataId: markers[0].metadataId } } } });
  plan.changes.push({ tab: OB_EDIT_NAME, retired: true });
}

// Compatibility with old installed triggers until setup removes them. Never accept edits.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Former trigger entrypoint.
function onObSheetEdit() {}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Former trigger entrypoint.
function onObSheetChange() {}

// Two alternating slots: publish the pointer only after every chunk has been written.
function writeObStatusState_(properties, state) {
  var pointer = properties.getProperty('OB_STATUS_STATE_SLOT') === 'A' ? 'B' : 'A';
  var raw = 'gz:' + Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(state), 'application/json')).getBytes());
  var count = Math.ceil(raw.length / 6000), values = {};
  if (raw.length > 150000) throw new Error('OB private baseline exceeds storage; input preserved');
  for (var i = 0; i < count; i++) values['OB_STATUS_' + pointer + '_' + i] = raw.slice(i * 6000, (i + 1) * 6000);
  values['OB_STATUS_' + pointer + '_COUNT'] = String(count);
  properties.setProperties(values);
  properties.setProperty('OB_STATUS_STATE_SLOT', pointer);
}

function readObStatusState_(properties) {
  var slot = properties.getProperty('OB_STATUS_STATE_SLOT');
  if (!slot) return null;
  var count = Number(properties.getProperty('OB_STATUS_' + slot + '_COUNT')), raw = '';
  if (!Number.isSafeInteger(count) || count < 1 || count > 25) throw new Error('OB baseline incomplete');
  for (var i = 0; i < count; i++) { var chunk = properties.getProperty('OB_STATUS_' + slot + '_' + i); if (chunk === null) throw new Error('OB baseline incomplete'); raw += chunk; }
  if (raw.slice(0, 3) !== 'gz:') throw new Error('OB baseline encoding invalid');
  return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(raw.slice(3)), 'application/gzip')).getDataAsString('UTF-8'));
}

function installObResultsTrigger() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('OB output setup is already running');
  try {
    var existing = ScriptApp.getProjectTriggers().filter(function(trigger) { return trigger.getHandlerFunction() === 'publishObResults'; });
    if (existing.length > 1) throw new Error('Duplicate OB output triggers; review before enabling');
    if (!existing.length) ScriptApp.newTrigger('publishObResults').timeBased().everyMinutes(5).create();
    ScriptApp.getProjectTriggers().filter(function(t) { return ['onObSheetEdit','onObSheetChange'].indexOf(t.getHandlerFunction()) >= 0; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  } finally { lock.releaseLock(); }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Public entrypoint in the Apps Script editor.
function stopObResultsTrigger() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('OB output is already running');
  try {
    ScriptApp.getProjectTriggers().filter(function(trigger) { return ['publishObResults','onObSheetEdit','onObSheetChange'].indexOf(trigger.getHandlerFunction()) >= 0; }).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  } finally { lock.releaseLock(); }
}
