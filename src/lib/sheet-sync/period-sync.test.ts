import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OCTOBER_SHEET_ID } from "@/lib/sheet-period";
import { relevantSheetHeaderSignature } from "@/lib/sheet-field-config";

const state = vi.hoisted(() => ({ profiles: [] as Record<string, unknown>[], records: [] as Record<string, unknown>[], clears: [] as Record<string, unknown>[], writes: [] as { table: string; op: string; value: unknown }[], fetch: vi.fn(), gas: vi.fn(), replies: vi.fn(), flush: vi.fn(), zeroAck: false }));
vi.mock("./reply-deletions", () => ({ flushReplyDeletions: state.flush }));
vi.mock("./gas-client", () => ({ fetchAllRaw: state.fetch, gasPost: state.gas }));
vi.mock("./replies", () => ({ reconcileSheetReplies: state.replies }));
import { runSheetSync } from "./run";

const admin = { from(table: string) {
  let op = "select";
  const filters: [string, unknown][] = [];
  const q = {
    select: () => q, not: () => q, is: (key: string, value: unknown) => { filters.push([key, value]); return q; }, order: () => q, range: () => q,
    in: (key: string, value: unknown) => { filters.push([key, value]); return q; },
    eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, gte: () => q,
    insert: (value: unknown) => { op = "insert"; state.writes.push({ table, op, value }); return q; },
    update: (value: unknown) => { op = "update"; state.writes.push({ table, op, value }); return q; },
    upsert: (value: unknown) => { op = "upsert"; state.writes.push({ table, op, value }); return q; }, delete: () => { op = "delete"; state.writes.push({ table, op, value: null }); return q; },
    then(resolve: (value: unknown) => void) {
      let data = table === "profiles" ? state.profiles : table === "practice_records" ? state.records : table === "sheet_pending_clears" ? state.clears : [];
      data = data.filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : value === null ? row[key] == null : row[key] === value));
      return Promise.resolve({ data: op === "select" || (op === "update" && table === "practice_records" && !state.zeroAck) ? data : [], error: null }).then(resolve);
    },
  };
  return q;
} } as unknown as SupabaseClient;

function profile(mode?: "sheet" | "app_only" | "off", id = "regular") {
  return { id, sheet_name: "B1 test", record_fields: [], record_source: "sheet", sheet_header_signature: null, sheet_history_imported_at: null,
    ...(mode ? { sheet_transition: { version: "2026-10", mode, confirmed_at: "2026-09-29", legacy: { sheet_name: "B1 old", record_fields: [], sheet_header_signature: null, record_source: "sheet" } } } : {}) };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T03:00:00Z"));
  state.writes = []; state.records = []; state.profiles = []; state.clears = []; state.zeroAck = false;
  state.flush.mockReset().mockResolvedValue([]);
  state.gas.mockReset().mockResolvedValue({ success: true });
  state.replies.mockReset().mockResolvedValue({ synced: 0, failedMembers: [] });
  state.fetch.mockReset().mockImplementation(async (inputs: { name: string }[], spreadsheetId?: string) => ({
    members: inputs.map(input => ({ name: input.name, header: ["日付", "感想"], records: [
      { date: "2026-09-30", cells: { 感想: "旧" } }, { date: "2026-10-01", cells: { 感想: spreadsheetId ? "新" : "旧の10月" } },
    ] })), signatures: new Map(), failedMembers: [], unchangedMembers: [],
  }));
});
afterEach(() => vi.useRealTimers());
describe("period-aware scheduled synchronization", () => {
  it("timestamps both new and changed imports at their batch time without moving an unchanged day", async () => {
    state.profiles = [profile("sheet")];
    state.records = [{ id: "existing", user_id: "regular", recorded_date: "2026-09-30", memo: "before", from_sheet: true }];
    const result = await runSheetSync(admin);
    expect(result.updated).toBe(1);
    const changed = state.writes.find(w => w.table === "practice_records" && w.op === "update")?.value;
    expect(changed).toMatchObject({ memo: "旧", created_at: "2026-10-02T02:59:59.998Z", synced_at: "2026-10-02T03:00:00.000Z" });
    expect(state.writes.find(w => w.table === "practice_records" && w.op === "insert")?.value).toEqual([
      expect.objectContaining({ recorded_date: "2026-10-01", created_at: "2026-10-02T02:59:59.999Z" }),
    ]);
    state.writes = [];
    state.records = [
      { id: "existing", user_id: "regular", recorded_date: "2026-09-30", memo: "旧" },
      { id: "new", user_id: "regular", recorded_date: "2026-10-01", memo: "新" },
    ];
    vi.setSystemTime(new Date("2026-10-03T03:00:00Z"));
    const repeated = await runSheetSync(admin);
    expect(repeated.inserted).toBe(0);
    expect(repeated.updated).toBe(0);
    expect(state.writes.filter(w => w.table === "practice_records")).toEqual([]);
  });

  it("imports and sends through a uniquely relocated confirmed comment column", async () => {
    const fields = [{ key: "memo", label: "コメント", type: "text" as const, sourceColumn: 13, sourceHeader: "コメント", showInTimeline: true }];
    state.profiles = [{ ...profile("sheet"), record_fields: fields, sheet_header_signature: relevantSheetHeaderSignature([{ index: 13, label: "コメント" }], fields, false) }];
    state.fetch.mockImplementation(async (inputs: { name: string }[], spreadsheetId?: string) => ({
      members: inputs.map(i => ({ name: i.name, columns: [{ index: 12, label: "コメント" }], header: ["コメント"], records: [{ date: "2026-10-01", cells: { コメント: "移動後の入力" }, values: Array.from({ length: 13 }, (_, c) => c === 12 ? "移動後の入力" : "") }] })),
      signatures: new Map(), failedMembers: [], unchangedMembers: [], spreadsheetId,
    }));
    const imported = await runSheetSync(admin);
    expect(imported.failedMembers).toEqual([]);
    expect(imported.inserted).toBe(1);
    expect(state.writes.find(w => w.table === "practice_records" && w.op === "insert")?.value).toEqual([expect.objectContaining({ memo: "移動後の入力" })]);
    state.records = [{ id: "pending", user_id: "regular", recorded_date: "2026-10-01", memo: "アプリの入力", pending_sheet_push: true }];
    await runSheetSync(admin);
    expect(state.gas).toHaveBeenCalledWith(expect.objectContaining({ cells: { コメント: "アプリの入力" }, spreadsheetId: OCTOBER_SHEET_ID }));
    state.gas.mockRejectedValueOnce(new Error("write response lost"));
    expect((await runSheetSync(admin)).sheetWritesUncertain).toBe(true);
  });

  it("retains the member's records for an actual header rename without blocking unrelated sheet writes", async () => {
    const fields = [{ key: "memo", label: "感想", type: "text" as const, sourceColumn: 1, sourceHeader: "振り返り" }];
    state.profiles = [{ ...profile("sheet"), record_fields: fields, sheet_header_signature: '[[1,"振り返り"]]' }];
    const result = await runSheetSync(admin);
    expect(result.failedMembers).toHaveLength(1);
    expect(result.inserted).toBe(1); // Only the old period remains compatible.
    expect(result.sheetWritesUncertain).toBe(false);
    expect(state.gas).not.toHaveBeenCalled();
    expect(state.replies.mock.calls.at(-1)?.[1]).toEqual([]);
  });
  it("keeps a complete spreadsheet read failure distinct from an uncertain sheet write", async () => {
    state.profiles = [profile("sheet")];
    state.fetch.mockRejectedValue(new Error("CSV unavailable"));
    const result = await runSheetSync(admin);
    expect(result.failedMembers).toHaveLength(2);
    expect(result.sheetWritesUncertain).toBe(false);
    expect(state.gas).not.toHaveBeenCalled();
  });
  it("uses the old name for September and the new workbook for October", async () => {
    state.profiles = [profile("sheet")];
    const result = await runSheetSync(admin);
    expect(result.failedMembers).toEqual([]);
    expect(result.inserted).toBe(2);
    const inserts = state.writes.filter(w => w.table === "practice_records" && w.op === "insert").flatMap(w => w.value as { recorded_date: string; memo: string }[]);
    expect(inserts.map(row => [row.recorded_date, row.memo])).toEqual([["2026-09-30", "旧"], ["2026-10-01", "新"]]);
    expect(state.fetch.mock.calls.map(call => [call[0][0].name, call[1]])).toEqual([["B1 old", undefined], ["B1 test", OCTOBER_SHEET_ID]]);
    expect(state.replies.mock.calls.map(call => call[6])).toEqual([undefined, OCTOBER_SHEET_ID]);
  });
  it("blocks imports and replies for app-only input but still sends pending records", async () => {
    state.profiles = [profile("app_only")];
    state.records = [{ id: "r", user_id: "regular", recorded_date: "2026-10-01", memo: "アプリ", pending_sheet_push: true, updated_at: "2026-10-01T12:00:00Z" }];
    const result = await runSheetSync(admin);
    expect(result.inserted).toBe(0); expect(result.updated).toBe(0); expect(result.pushed).toBe(1);
    expect(state.gas).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: OCTOBER_SHEET_ID, date: "2026-10-01", cells: { 感想: "アプリ" } }));
    expect(state.replies.mock.calls.every(call => call[1].length === 0)).toBe(true);
  });
  it("retains pending input when the sheet omits an item or a concurrent edit prevents acknowledgement", async () => {
    state.profiles = [profile("app_only")];
    state.records = [{ id: "r", user_id: "regular", recorded_date: "2026-10-01", memo: "保存済みの入力", pending_sheet_push: true }];
    state.gas.mockResolvedValueOnce({ success: true, unmapped: ["感想"] });
    let result = await runSheetSync(admin);
    expect(result.pushed).toBe(0);
    expect(result.sheetWritesUncertain).toBe(true);
    expect(state.writes.some(w => w.table === "practice_records" && w.op === "update")).toBe(false);
    state.zeroAck = true;
    result = await runSheetSync(admin);
    expect(result.pushed).toBe(0);
    expect(result.failedMembers[0].reason).toContain("送信中に記録");
    expect(result.sheetWritesUncertain).toBe(true);
  });
  it("off skips both workbooks including pending sends", async () => {
    state.profiles = [profile("off")];
    state.records = [{ id: "r", user_id: "regular", recorded_date: "2026-10-01", pending_sheet_push: true }];
    const result = await runSheetSync(admin);
    expect(result.inserted).toBe(0); expect(result.pushed).toBe(0);
    expect(state.fetch).not.toHaveBeenCalled(); expect(state.gas).not.toHaveBeenCalled();
    expect(state.replies).not.toHaveBeenCalled();
  });
  it("continues imports while holding pending sends and replies after an uncertain write", async () => {
    state.profiles = [profile("sheet")];
    state.records = [{ id: "r", user_id: "regular", recorded_date: "2026-10-01", memo: "未送信の入力", pending_sheet_push: true }];
    state.clears = [{ user_id: "regular", recorded_date: "2026-10-02" }];
    const result = await runSheetSync(admin, { skipSheetWrites: true });
    expect(result.sheetWritesSkipped).toBe(true);
    expect(result.inserted).toBe(1); // September import still proceeds.
    expect(result.pushed).toBe(0);
    expect(state.gas).not.toHaveBeenCalled();
    expect(state.replies).not.toHaveBeenCalled();
    expect(state.flush).not.toHaveBeenCalled();
    expect(state.writes.some(w => w.table === "sheet_pending_clears" && w.op === "delete")).toBe(false);
    expect(state.writes.some(w => w.table === "practice_records" && w.op === "update")).toBe(false);
    expect(state.records[0].pending_sheet_push).toBe(true);
  });
  it("does not route an unconfirmed member's October records to the old workbook", async () => {
    state.profiles = [profile()];
    expect((await runSheetSync(admin)).inserted).toBe(1);
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][1]).toBeUndefined();
  });
  it("closes the old period for every member, including those not yet confirmed", async () => {
    vi.setSystemTime(new Date("2026-10-07T15:00:00Z"));
    state.profiles = [profile("sheet"), { ...profile(undefined, "regular"), sheet_name: "B2 regular" }];
    expect((await runSheetSync(admin)).inserted).toBe(1);
    expect(state.fetch.mock.calls.map(call => call[0][0].name)).toEqual(["B1 test"]);
  });
});
