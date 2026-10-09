import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
import { obPublishedResultSheets, obResultSheet } from "./ob-results-sheet";
import { OB_PROGRAM } from "./ob-meet";
import { OB_RESULTS_SPREADSHEET_ID } from "./ob-results-feed-auth";
import type { ObEntry } from "./ob-entries";
import { emptyPerformance } from "./meet-operations";
import type { ObEventOperation } from "./ob-operations";

type Cell = { userEnteredValue?: { stringValue?: string; numberValue?: number } };
type Bounds = { sheetId: number; rows: number; columns: number };
type Metadata = { metadataId: number; metadataKey: string; metadataValue: string };
type Target = { properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number; frozenRowCount?: number } }; cells: Cell[][] };
type Workbook = { sheets: Target[]; developerMetadata: Metadata[] };
type Request = {
  insertDimension?: { range: { sheetId: number; dimension: string; startIndex: number; endIndex: number } };
  appendDimension?: { sheetId: number; dimension: string; length: number };
  updateCells?: { range: { sheetId: number; endRowIndex: number; endColumnIndex: number }; rows: { values: Cell[] }[] };
  createDeveloperMetadata?: { developerMetadata: Metadata };
  updateDeveloperMetadata?: { dataFilters: { developerMetadataLookup: { metadataId: number } }[]; developerMetadata: { metadataValue: string } };
};
type GasApi = {
  publishObResults(): { changed: boolean };
  dryRunObResultsPublish(): { changed: boolean };
  initializeObPublisher(): { changed: boolean };
  OB_RESULTS_BOOTSTRAP?: { readToken: string; initialRanges: Bounds[] };
};
const roster: ObEntry[] = [{ id: "synthetic-id", meet_key: "ob-2026", submitted_name: "=HYPERLINK(合成)", grade: "OB・OG", events: ["男子100m"], profile_id: null, revision: 0, imported_at: "", qualification_marks: {} }];
function snapshot(entries = roster, operations: ObEventOperation[] = []) {
  const sheets = obPublishedResultSheets(entries, operations);
  return { schemaVersion: 1, meetKey: "ob-2026", spreadsheetId: OB_RESULTS_SPREADSHEET_ID, generatedAt: "2026-10-09T18:00:00Z", entryCount: entries.length,
    revision: createHash("sha256").update(JSON.stringify(sheets)).digest("hex"), sheets };
}

function setup() {
  const source = snapshot();
  const originals = [source.sheets[0], ...OB_PROGRAM.flatMap(slot => slot.events).map(family => obResultSheet(family, roster, []))];
  const initial: Bounds[] = originals.map((sheet, i) => ({ sheetId: i + 1, rows: sheet.rows.length, columns: sheet.widths!.length }));
  const cell = (text: string): Cell => ({ userEnteredValue: { stringValue: text } });
  const workbook: Workbook = { developerMetadata: [], sheets: originals.map((sheet, index) => {
    const cells = Array.from({ length: 100 }, () => Array.from({ length: 26 }, () => ({} as Cell)));
    sheet.rows.forEach((row, r) => row.forEach((value, c) => { cells[r][c] = value === null ? {} : typeof value === "number" ? { userEnteredValue: { numberValue: value } } : cell(value); }));
    cells[0][sheet.widths!.length] = cell("独自列");
    cells[1][sheet.widths!.length] = cell("右の独自追記");
    cells[sheet.rows.length][0] = cell("下の独自追記");
    return { properties: { sheetId: index + 1, title: sheet.name, gridProperties: { rowCount: 100, columnCount: 26 } }, cells };
  }) };
  workbook.sheets.push({ properties: { sheetId: 99, title: "独自タブ", gridProperties: { rowCount: 100, columnCount: 26 } }, cells: [[cell("保持")]] });
  const state = { workbook, source, code: 200, writes: [] as Request[][], properties: { OB_RESULTS_READ_TOKEN: "a".repeat(64), OB_RESULTS_INITIAL_RANGES: JSON.stringify(initial) } as Record<string, string>,
    unknownAfterCommit: false, rejectBatch: false, triggers: [] as string[], timezone: "" };
  const applyBatch = (requests: Request[]) => {
    if (state.rejectBatch) throw new Error("synthetic rejected batch");
    const next = structuredClone(state.workbook);
    for (const request of requests) {
      if (request.appendDimension) {
        const value = request.appendDimension, target = next.sheets.find(sheet => sheet.properties.sheetId === value.sheetId)!;
        if (value.dimension === "ROWS") { target.properties.gridProperties.rowCount += value.length; for (let i = 0; i < value.length; i++) target.cells.push([]); }
        else { target.properties.gridProperties.columnCount += value.length; target.cells.forEach(row => row.push(...Array.from({ length: value.length }, () => ({})))); }
      }
      if (request.insertDimension) {
        const range = request.insertDimension.range, target = next.sheets.find(sheet => sheet.properties.sheetId === range.sheetId)!;
        const count = range.endIndex - range.startIndex;
        if (range.dimension === "ROWS") { target.cells.splice(range.startIndex, 0, ...Array.from({ length: count }, () => [])); target.properties.gridProperties.rowCount += count; }
        else { target.cells.forEach(row => row.splice(range.startIndex, 0, ...Array.from({ length: count }, () => ({})))); target.properties.gridProperties.columnCount += count; }
      }
      if (request.updateCells) {
        const update = request.updateCells, target = next.sheets.find(sheet => sheet.properties.sheetId === update.range.sheetId)!;
        for (let row = 0; row < update.range.endRowIndex; row++) {
          target.cells[row] ??= [];
          for (let col = 0; col < update.range.endColumnIndex; col++) target.cells[row][col] = update.rows[row]?.values[col] ?? {};
        }
      }
      if (request.createDeveloperMetadata) next.developerMetadata.push({ ...request.createDeveloperMetadata.developerMetadata, metadataId: 1 });
      if (request.updateDeveloperMetadata) {
        const update = request.updateDeveloperMetadata;
        next.developerMetadata.find(value => value.metadataId === update.dataFilters[0].developerMetadataLookup.metadataId)!.metadataValue = update.developerMetadata.metadataValue;
      }
    }
    state.workbook = next;
    state.writes.push(requests);
    if (state.unknownAfterCommit) { state.unknownAfterCommit = false; throw new Error("synthetic response lost after commit"); }
  };
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => state.properties[key], setProperties: (values: Record<string, string>) => Object.assign(state.properties, values) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => state.code, getContentText: () => JSON.stringify(state.source) }) },
    Sheets: { Spreadsheets: { get: () => state.workbook, batchUpdate: (body: { requests: Request[] }, id: string) => { expect(id).toBe(OB_RESULTS_SPREADSHEET_ID); applyBatch(body.requests); } } },
    Utilities: { formatDate: (_date: Date, timezone: string) => { state.timezone = timezone; return "2026-10-10 03:00:00"; } },
    ScriptApp: { getProjectTriggers: () => state.triggers.map(handler => ({ getHandlerFunction: () => handler })), newTrigger: (handler: string) => ({ timeBased: () => ({ everyMinutes: (minutes: number) => ({ create: () => { expect(minutes).toBe(5); state.triggers.push(handler); } }) }) }) },
  });
  vm.runInContext(readFileSync(new URL("../../gas/ob-results-publish/Code.js", import.meta.url), "utf8"), context);
  return { state, api: context as unknown as GasApi, initial };
}

it("updates all twelve tabs in one batch, treats formula-looking names as text, and preserves independent notes and tabs", () => {
  const { state, api, initial } = setup();
  expect(api.dryRunObResultsPublish().changed).toBe(true);
  expect(state.writes).toHaveLength(0);
  expect(api.publishObResults().changed).toBe(true);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].filter(request => request.updateCells)).toHaveLength(12);
  for (const request of state.writes[0]) if (request.updateCells) {
    expect(request.updateCells.rows).toHaveLength(request.updateCells.range.endRowIndex);
    for (const row of request.updateCells.rows) expect(row.values).toHaveLength(request.updateCells.range.endColumnIndex);
  }
  for (const [index, source] of state.source.sheets.entries()) {
    const target = state.workbook.sheets[index], managedCols = source.widths!.length;
    expect(target.cells[0][managedCols].userEnteredValue?.stringValue).toBe("独自列");
    expect(target.cells[1][managedCols].userEnteredValue?.stringValue).toBe("右の独自追記");
    expect(target.cells[Math.max(source.rows.length, initial[index].rows)][0].userEnteredValue?.stringValue).toBe("下の独自追記");
  }
  expect(state.workbook.sheets[12].cells[0][0].userEnteredValue?.stringValue).toBe("保持");
  expect(state.workbook.sheets[4].cells[1][3].userEnteredValue).toEqual({ stringValue: "=HYPERLINK(合成)" });
  expect(state.timezone).toBe("Asia/Tokyo");
});

it("observes committed metadata after an unknown response and never repeats a column insertion", () => {
  const { state, api } = setup();
  state.unknownAfterCommit = true;
  expect(() => api.publishObResults()).toThrow("response lost");
  const before = structuredClone(state.workbook);
  expect(api.publishObResults().changed).toBe(false);
  expect(state.writes).toHaveLength(1);
  expect(state.workbook).toEqual(before);
});

it("applies a new app registration, attendance change, DNS and restored participation", () => {
  const { state, api } = setup();
  api.publishObResults();
  const second = { ...roster[0], id: "second", submitted_name: "追加合成", absent: true };
  state.source = snapshot([...roster, second]);
  api.publishObResults();
  expect(state.workbook.sheets[4].cells[2][3].userEnteredValue?.stringValue).toBe("追加合成");
  expect(state.workbook.sheets[4].cells[2][5].userEnteredValue?.stringValue).toBe("不参加");
  expect(state.workbook.sheets[4].cells[2][6].userEnteredValue?.stringValue).toBe("欠席");
  const operation: ObEventOperation = { meet_key: "ob-2026", event_name: "男子100m", revision: 1, updated_at: "", data: { confirmed: false, participants: [{ ...emptyPerformance("second"), status: "DNS" }] } };
  state.source = snapshot([...roster, { ...second, absent: false }], [operation]);
  api.publishObResults();
  const target = state.workbook.sheets[4], nameRows = target.cells.filter(row => row[3]?.userEnteredValue?.stringValue === "追加合成");
  expect(nameRows[0][5].userEnteredValue?.stringValue).toBe("参加");
  expect(nameRows[0][6].userEnteredValue?.stringValue).toBe("DNS（欠場）");
  state.source = snapshot([...roster, { ...second, absent: false }]);
  api.publishObResults();
  expect(state.workbook.sheets[4].cells[2][6].userEnteredValue?.stringValue).toBe("出場");
  state.source = snapshot();
  api.publishObResults();
  expect(state.workbook.sheets[4].cells[2][3]).toEqual({});
  expect(state.workbook.sheets[4].cells[3][0].userEnteredValue?.stringValue).toBe("下の独自追記");
  expect(state.writes).toHaveLength(5);
});

it("preserves the old workbook after source errors, a wrong target, missing ranges, renamed tabs or batch failure", () => {
  for (const scenario of ["source", "target", "ranges", "rename", "batch"] as const) {
    const { state, api } = setup();
    if (scenario === "source") state.code = 503;
    if (scenario === "target") state.source.spreadsheetId = "wrong";
    if (scenario === "ranges") delete state.properties.OB_RESULTS_INITIAL_RANGES;
    if (scenario === "rename") state.workbook.sheets[4].properties.title = "renamed";
    if (scenario === "batch") state.rejectBatch = true;
    const before = structuredClone(state.workbook);
    expect(() => api.publishObResults()).toThrow();
    expect(state.workbook).toEqual(before);
    expect(state.writes).toHaveLength(0);
  }
});

it("starts exactly one five-minute trigger only after successful setup and verification", () => {
  const { state, api, initial } = setup();
  delete state.properties.OB_RESULTS_READ_TOKEN;
  delete state.properties.OB_RESULTS_INITIAL_RANGES;
  api.OB_RESULTS_BOOTSTRAP = { readToken: "b".repeat(64), initialRanges: initial };
  state.code = 503;
  expect(() => api.initializeObPublisher()).toThrow();
  expect(state.triggers).toHaveLength(0);
  state.code = 200;
  api.initializeObPublisher();
  api.initializeObPublisher();
  expect(state.triggers).toEqual(["publishObResults"]);
  expect(state.writes).toHaveLength(1);
});
