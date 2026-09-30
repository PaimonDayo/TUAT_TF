import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OCTOBER_SHEET_ID } from "@/lib/sheet-period";

const state = vi.hoisted(() => ({ profiles: [] as Record<string, unknown>[], records: [] as Record<string, unknown>[], writes: [] as { table: string; op: string; value: unknown }[], fetch: vi.fn(), gas: vi.fn(), replies: vi.fn() }));
vi.mock("./period-routing", () => ({ systemSheetProfileIds: async () => new Set(["pilot"]) }));
vi.mock("./reply-deletions", () => ({ flushReplyDeletions: async () => [] }));
vi.mock("./gas-client", () => ({ fetchAllRaw: state.fetch, gasPost: state.gas }));
vi.mock("./replies", () => ({ reconcileSheetReplies: state.replies }));
import { runSheetSync } from "./run";

const admin = { from(table: string) {
  let op = "select";
  const filters: [string, unknown][] = [];
  const q = {
    select: () => q, not: () => q, is: () => q, order: () => q, range: () => q,
    in: (key: string, value: unknown) => { filters.push([key, value]); return q; },
    eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, gte: () => q,
    insert: (value: unknown) => { op = "insert"; state.writes.push({ table, op, value }); return q; },
    update: (value: unknown) => { op = "update"; state.writes.push({ table, op, value }); return q; },
    upsert: (value: unknown) => { op = "upsert"; state.writes.push({ table, op, value }); return q; }, delete: () => q,
    then(resolve: (value: unknown) => void) {
      let data = table === "profiles" ? state.profiles : table === "practice_records" ? state.records : [];
      data = data.filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
      return Promise.resolve({ data: op === "select" ? data : [], error: null }).then(resolve);
    },
  };
  return q;
} } as unknown as SupabaseClient;

function profile(mode?: "sheet" | "app_only" | "off", id = "pilot") {
  return { id, sheet_name: "B1 test", record_fields: [], record_source: "sheet", sheet_header_signature: null, sheet_history_imported_at: null,
    ...(mode ? { sheet_transition: { version: "2026-10", mode, confirmed_at: "2026-09-29", legacy: { sheet_name: "B1 old", record_fields: [], sheet_header_signature: null, record_source: "sheet" } } } : {}) };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T03:00:00Z"));
  state.writes = []; state.records = []; state.profiles = [];
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
  it("uses the old name for September and the new workbook for October", async () => {
    state.profiles = [profile("sheet")];
    const result = await runSheetSync(admin);
    expect(result.failedMembers).toEqual([]);
    expect(result.inserted).toBe(2);
    const inserts = state.writes.filter(w => w.table === "practice_records" && w.op === "insert").flatMap(w => w.value as { recorded_date: string; memo: string }[]);
    expect(inserts.map(row => [row.recorded_date, row.memo])).toEqual([["2026-09-30", "旧"], ["2026-10-01", "新"]]);
    expect(state.fetch.mock.calls.map(call => [call[0][0].name, call[1]])).toEqual([["B1 old", undefined], ["B1 test", OCTOBER_SHEET_ID]]);
  });
  it("blocks imports and replies for app-only input but still sends pending records", async () => {
    state.profiles = [profile("app_only")];
    state.records = [{ id: "r", user_id: "pilot", recorded_date: "2026-10-01", memo: "アプリ", pending_sheet_push: true, updated_at: "2026-10-01T12:00:00Z" }];
    const result = await runSheetSync(admin);
    expect(result.inserted).toBe(0); expect(result.updated).toBe(0); expect(result.pushed).toBe(1);
    expect(state.gas).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: OCTOBER_SHEET_ID, date: "2026-10-01", cells: { 感想: "アプリ" } }));
    expect(state.replies.mock.calls.every(call => call[1].length === 0)).toBe(true);
  });
  it("off skips both workbooks including pending sends", async () => {
    state.profiles = [profile("off")];
    state.records = [{ id: "r", user_id: "pilot", recorded_date: "2026-10-01", pending_sheet_push: true }];
    const result = await runSheetSync(admin);
    expect(result.inserted).toBe(0); expect(result.pushed).toBe(0);
    expect(state.fetch).not.toHaveBeenCalled(); expect(state.gas).not.toHaveBeenCalled();
    expect(state.replies).not.toHaveBeenCalled();
  });
  it("does not route an unconfirmed pilot's October records to the old workbook", async () => {
    state.profiles = [profile()];
    expect((await runSheetSync(admin)).inserted).toBe(1);
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][1]).toBeUndefined();
  });
  it("closes the pilot's old period while leaving regular members unchanged", async () => {
    vi.setSystemTime(new Date("2026-10-07T15:00:00Z"));
    state.profiles = [profile("sheet"), { ...profile(undefined, "regular"), sheet_name: "B2 regular" }];
    expect((await runSheetSync(admin)).inserted).toBe(3);
    expect(state.fetch.mock.calls.map(call => call[0][0].name)).toEqual(["B2 regular", "B1 test"]);
  });
});
