import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OCTOBER_SHEET_ID } from "@/lib/sheet-period";
import { relevantSheetHeaderSignature } from "@/lib/sheet-field-config";
import { fetchPublicMemberSnapshot } from "@/lib/sheet-public-csv";

const state = vi.hoisted(() => ({ profiles: [] as Record<string, unknown>[], records: [] as Record<string, unknown>[], clears: [] as Record<string, unknown>[], syncStates: [] as Record<string, unknown>[], selects: [] as { table: string; columns: string }[], writes: [] as { table: string; op: string; value: unknown }[], fetch: vi.fn(), gas: vi.fn(), replies: vi.fn(), flush: vi.fn(), zeroAck: false, editBeforePullWrite: null as { id: string; patch: Record<string, unknown> } | null, editBeforeRecordsRead: null as { id: string; patch: Record<string, unknown> } | null }));
vi.mock("./reply-deletions", () => ({ flushReplyDeletions: state.flush }));
vi.mock("./gas-client", () => ({ fetchAllRaw: state.fetch, gasPost: state.gas }));
vi.mock("./replies", () => ({ reconcileSheetReplies: state.replies }));
import { runSheetSync } from "./run";

const admin = { from(table: string) {
  let op = "select";
  let selectedColumns = "";
  let updateValue: Record<string, unknown> | null = null;
  const filters: [string, unknown][] = [];
  const q = {
    select: (columns: string) => { selectedColumns = columns; state.selects.push({ table, columns }); return q; }, not: () => q, is: (key: string, value: unknown) => { filters.push([key, value]); return q; }, order: () => q, range: () => q,
    in: (key: string, value: unknown) => { filters.push([key, value]); return q; },
    eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, gte: () => q,
    insert: (value: unknown) => { op = "insert"; state.writes.push({ table, op, value }); return q; },
    update: (value: unknown) => { op = "update"; updateValue = value as Record<string, unknown>; state.writes.push({ table, op, value }); return q; },
    upsert: (value: unknown) => { op = "upsert"; state.writes.push({ table, op, value }); return q; }, delete: () => { op = "delete"; state.writes.push({ table, op, value: null }); return q; },
    then(resolve: (value: unknown) => void) {
      if (table === "practice_records" && op === "select" && selectedColumns.includes("from_sheet") && state.editBeforeRecordsRead) {
        const edited = state.records.find(row => row.id === state.editBeforeRecordsRead!.id);
        if (edited) Object.assign(edited, state.editBeforeRecordsRead.patch);
        state.editBeforeRecordsRead = null;
      }
      if (table === "practice_records" && op === "update" && state.editBeforePullWrite && updateValue?.memo !== undefined) {
        const edited = state.records.find(row => row.id === state.editBeforePullWrite!.id);
        if (edited) Object.assign(edited, state.editBeforePullWrite.patch);
        state.editBeforePullWrite = null;
      }
      let data = table === "profiles" ? state.profiles : table === "practice_records" ? state.records : table === "sheet_pending_clears" ? state.clears : table === "sheet_member_sync_state" ? state.syncStates : [];
      if (table === "practice_records") data = data.map(row => ({ updated_at: null, pending_sheet_push: false, ...row }));
      data = data.filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : value === null ? row[key] == null : row[key] === value));
      if (table === "practice_records" && op === "update" && !state.zeroAck) {
        for (const row of data) {
          const saved = state.records.find(record => record.id === row.id);
          if (saved) Object.assign(saved, updateValue);
        }
      }
      return Promise.resolve({ data: op === "select" || (op === "update" && table === "practice_records" && !state.zeroAck) ? data : [], error: null }).then(resolve);
    },
  };
  return q;
} } as unknown as SupabaseClient;

function profile(mode?: "sheet" | "app_only" | "off", id = "regular") {
  return { id, sheet_name: "B1 test", record_fields: [], record_source: "sheet", sheet_header_signature: null, sheet_history_imported_at: null,
    ...(mode ? { sheet_transition: { version: "2026-10", mode, confirmed_at: "2026-09-29", legacy: { sheet_name: "B1 old", record_fields: [], sheet_header_signature: null, record_source: "sheet" } } } : {}) };
}
function useIdenticalCsv(csv: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(csv, { headers: { "content-type": "text/csv" } })));
  state.fetch.mockImplementation(async (inputs: { name: string; previousSignature: string | null; forceParse: boolean }[]) => {
    const snapshots = await Promise.all(inputs.map(async input => ({ name: input.name, snapshot: await fetchPublicMemberSnapshot(input.name, {
      spreadsheetId: OCTOBER_SHEET_ID,
      members: [{ name: input.name, gid: "1" }],
      expectedSignature: input.previousSignature,
      forceParse: input.forceParse,
    }) })));
    return {
      members: snapshots.flatMap(item => item.snapshot.member ? [item.snapshot.member] : []),
      unchangedMembers: snapshots.filter(item => !item.snapshot.member).map(item => item.name),
      signatures: new Map(snapshots.map(item => [item.name, item.snapshot.signature])),
      failedMembers: [],
    };
  });
}

function keepSuccessfulImports() {
  const inserted = state.writes.filter(write => write.table === "practice_records" && write.op === "insert")
    .flatMap(write => write.value as Record<string, unknown>[]);
  state.records.push(...inserted.map((row, index) => ({ ...row, id: `import-${state.records.length + index}` })));
  state.syncStates = state.writes.find(write => write.table === "sheet_member_sync_state" && write.op === "upsert")?.value as Record<string, unknown>[];
  state.writes = [];
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T03:00:00Z"));
  state.writes = []; state.records = []; state.profiles = []; state.clears = []; state.syncStates = []; state.selects = []; state.zeroAck = false; state.editBeforePullWrite = null; state.editBeforeRecordsRead = null;
  state.flush.mockReset().mockResolvedValue([]);
  state.gas.mockReset().mockResolvedValue({ success: true });
  state.replies.mockReset().mockResolvedValue({ synced: 0, failedMembers: [] });
  state.fetch.mockReset().mockImplementation(async (inputs: { name: string }[], spreadsheetId?: string) => ({
    members: inputs.map(input => ({ name: input.name, header: ["日付", "感想"], records: [
      { date: "2026-09-30", cells: { 感想: "旧" } }, { date: "2026-10-01", cells: { 感想: spreadsheetId ? "新" : "旧の10月" } },
    ] })), signatures: new Map(), failedMembers: [], unchangedMembers: [],
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("period-aware scheduled synchronization", () => {
  it("fills initial history in its original dates, including legacy rows, and publishes only the latest eligible day", async () => {
    vi.setSystemTime(new Date("2026-10-06T15:00:00.000Z")); // 10/7 00:00 JST
    state.profiles = [profile("sheet")];
    state.records = [{ id: "existing-history", user_id: "regular", recorded_date: "2026-09-29", memo: "before", from_sheet: true, created_at: "2026-09-29T05:00:00.000Z" }];
    const dates = ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];
    state.fetch.mockImplementation(async (inputs: { name: string }[]) => ({
      members: inputs.map(input => ({ name: input.name, header: ["日付", "感想"], records: dates.map(date => ({ date, cells: { 感想: "synthetic history" } })) })),
      signatures: new Map(), failedMembers: [], unchangedMembers: [],
    }));
    expect(await runSheetSync(admin, { includeToday: false })).toMatchObject({ inserted: 7, updated: 1, failedMembers: [] });
    expect(state.records[0]).toMatchObject({ memo: "synthetic history", from_sheet: true, created_at: "2026-09-29T05:00:00.000Z" });
    const rows = state.writes.filter(write => write.table === "practice_records" && write.op === "insert").flatMap(write => write.value as Record<string, unknown>[]);
    expect(rows.map(row => [row.recorded_date, row.created_at])).toEqual([
      ["2026-09-30", "2026-09-29T15:00:00.000Z"],
      ["2026-10-01", "2026-09-30T15:00:00.000Z"],
      ["2026-10-02", "2026-10-01T15:00:00.000Z"],
      ["2026-10-03", "2026-10-02T15:00:00.000Z"],
      ["2026-10-04", "2026-10-03T15:00:00.000Z"],
      ["2026-10-05", "2026-10-04T15:00:00.000Z"],
      ["2026-10-06", "2026-10-06T14:59:59.999Z"],
    ]);
    expect(rows.every(row => row.synced_at === "2026-10-06T15:00:00.000Z" && row.updated_at === "2026-10-06T15:00:00.000Z" && row.from_sheet === true)).toBe(true);
    expect(state.writes.find(write => write.table === "profiles" && write.op === "update")?.value).toEqual({ sheet_history_imported_at: "2026-10-06T15:00:00.000Z" });
  });

  it("continues publishing a late new sheet entry at sync time after initial history is complete", async () => {
    vi.setSystemTime(new Date("2026-10-07T15:00:00.000Z"));
    state.profiles = [{ ...profile("sheet"), sheet_history_imported_at: "2026-10-01T00:00:00.000Z" }];
    useIdenticalCsv("日付,感想\n10/5,late new entry");
    expect(await runSheetSync(admin, { includeToday: false })).toMatchObject({ inserted: 1, updated: 0 });
    expect(state.writes.find(write => write.table === "practice_records" && write.op === "insert")?.value).toEqual([
      expect.objectContaining({ recorded_date: "2026-10-05", created_at: "2026-10-07T14:59:59.997Z", synced_at: "2026-10-07T15:00:00.000Z" }),
    ]);
  });

  it("fills initial prior-year history without turning it into a new post on January 1", async () => {
    vi.setSystemTime(new Date("2026-12-31T15:00:00.000Z"));
    state.profiles = [profile("sheet")];
    useIdenticalCsv("日付,感想\n12/30,history\n12/31,yesterday\n1/1,prefilled today");
    expect(await runSheetSync(admin, { includeToday: false })).toMatchObject({ inserted: 2, updated: 0 });
    expect(state.writes.find(write => write.table === "practice_records" && write.op === "insert")?.value).toEqual([
      expect.objectContaining({ recorded_date: "2026-12-30", created_at: "2026-12-29T15:00:00.000Z" }),
      expect.objectContaining({ recorded_date: "2026-12-31", created_at: "2026-12-31T14:59:59.999Z" }),
    ]);
  });

  it("preserves an app save and completed write-through occurring during a stale CSV read", async () => {
    vi.setSystemTime(new Date("2026-10-07T15:00:00.000Z"));
    state.profiles = [{ ...profile("sheet"), sheet_history_imported_at: "2026-10-01T00:00:00.000Z" }];
    state.records = [{ id: "saved-during-csv", user_id: "regular", recorded_date: "2026-10-07", memo: "earlier app contents", from_sheet: false, created_at: "2026-10-07T05:00:00.000Z", updated_at: "2026-10-07T05:00:00.000Z", pending_sheet_push: false }];
    useIdenticalCsv("日付,感想\n10/7,stale sheet contents");
    const fetchCsv = state.fetch.getMockImplementation()!;
    state.fetch.mockImplementation(async (...args) => {
      const snapshot = await fetchCsv(...args);
      Object.assign(state.records[0], { memo: "new app contents already sent", updated_at: "2026-10-07T15:00:01.000Z", synced_at: "2026-10-07T15:00:01.000Z", pending_sheet_push: false });
      return snapshot;
    });
    const result = await runSheetSync(admin, { includeToday: false });
    expect(result).toMatchObject({ inserted: 0, updated: 0, pushed: 0, sheetWritesUncertain: false });
    expect(result.failedMembers).toEqual([{ member: "B1 test", reason: expect.stringContaining("同期中に記録の状態が変わりました") }]);
    expect(state.records[0]).toMatchObject({ memo: "new app contents already sent", updated_at: "2026-10-07T15:00:01.000Z", synced_at: "2026-10-07T15:00:01.000Z", pending_sheet_push: false, created_at: "2026-10-07T05:00:00.000Z" });
    expect(state.writes.some(write => write.table === "sheet_member_sync_state" && write.op === "upsert")).toBe(false);
    expect(state.gas).not.toHaveBeenCalled();
  });

  it("reparses identical CSV for pending input first seen by the full DB snapshot", async () => {
    vi.setSystemTime(new Date("2026-10-07T15:00:00.000Z"));
    state.profiles = [{ ...profile("sheet"), sheet_history_imported_at: "2026-10-01T00:00:00.000Z" }];
    useIdenticalCsv("日付,感想\n10/7,initial sheet contents");
    await runSheetSync(admin, { includeToday: false });
    keepSuccessfulImports();
    state.editBeforeRecordsRead = { id: String(state.records[0].id), patch: { memo: "new pending app contents", updated_at: "2026-10-07T15:00:01.000Z", pending_sheet_push: true } };
    const result = await runSheetSync(admin, { includeToday: false });
    expect(state.fetch.mock.calls.at(-1)?.[0][0].forceParse).toBe(true);
    expect(result).toMatchObject({ inserted: 0, updated: 0, pushed: 1, failedMembers: [] });
    expect(state.gas).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-07", cells: { 感想: "new pending app contents" } }));
    expect(state.records[0]).toMatchObject({ memo: "new pending app contents", pending_sheet_push: false });
  });

  it.each([
    { label: "a nullable original update time", original: null, edited: "2026-10-07T15:00:01.000Z", pending: true },
    { label: "an existing original update time", original: "2026-10-07T05:00:00.000Z", edited: "2026-10-07T15:00:01.000Z", pending: true },
    { label: "a changed pending flag alone", original: "2026-10-07T05:00:00.000Z", edited: "2026-10-07T05:00:00.000Z", pending: true },
    { label: "a changed update time alone", original: "2026-10-07T05:00:00.000Z", edited: "2026-10-07T15:00:01.000Z", pending: false },
  ])("retains a concurrent app edit with $label and reports the stale pull as a partial failure", async ({ original, edited, pending }) => {
    vi.setSystemTime(new Date("2026-10-07T15:00:00.000Z"));
    state.profiles = [{ ...profile("sheet"), sheet_history_imported_at: "2026-10-01T00:00:00.000Z" }];
    state.records = [{ id: "edited-during-sync", user_id: "regular", recorded_date: "2026-10-07", memo: "earlier app entry", from_sheet: false, created_at: "2026-10-07T05:00:00.000Z", updated_at: original, pending_sheet_push: false }];
    useIdenticalCsv("日付,感想\n10/7,stale sheet contents");
    state.editBeforePullWrite = { id: "edited-during-sync", patch: { memo: "newer app contents", updated_at: edited, pending_sheet_push: pending } };
    const result = await runSheetSync(admin, { includeToday: false });
    expect(result).toMatchObject({ inserted: 0, updated: 0, pushed: 0, sheetWritesUncertain: false });
    expect(result.failedMembers).toEqual([{ member: "B1 test", reason: expect.stringContaining("同期中に記録の状態が変わりました") }]);
    expect(state.records[0]).toMatchObject({ memo: "newer app contents", updated_at: edited, pending_sheet_push: pending, from_sheet: false, created_at: "2026-10-07T05:00:00.000Z" });
    expect(state.writes.filter(write => write.table === "practice_records" && write.op === "update")).toHaveLength(1);
    expect(state.writes.some(write => write.table === "sheet_member_sync_state" && write.op === "upsert")).toBe(false);
    expect(state.gas).not.toHaveBeenCalled();
  });

  it("imports a sheet correction without moving an app-authored post", async () => {
    state.profiles = [profile("sheet")];
    state.records = [{ id: "app-post", user_id: "regular", recorded_date: "2026-09-30", memo: "before", from_sheet: false, created_at: "2026-09-30T05:00:00.000Z" }];
    expect((await runSheetSync(admin)).updated).toBe(1);
    expect(state.selects.some(query => query.table === "practice_records" && query.columns.includes("from_sheet"))).toBe(true);
    expect(state.writes.find(write => write.table === "practice_records" && write.op === "update")?.value).toEqual({ memo: "旧", synced_at: "2026-10-02T03:00:00.000Z" });
    expect(state.records[0]).toMatchObject({ from_sheet: false, created_at: "2026-09-30T05:00:00.000Z" });
  });

  it("keeps old sheet input unchanged when the daily CSV recheck differs only in stored representations", async () => {
    vi.setSystemTime(new Date("2026-10-07T15:00:00.000Z"));
    const fields = [{ key: "sleep", label: "睡眠", type: "number" as const, sourceColumn: 2, sourceHeader: "睡眠" }];
    state.profiles = [{ ...profile("sheet"), record_fields: fields, sheet_history_imported_at: "2026-10-01T00:00:00.000Z" }];
    const stored = { id: "old-sheet-post", user_id: "regular", recorded_date: "2026-10-05", memo: " rest ", custom: { sleep: "8.0" }, from_sheet: true, created_at: "2026-10-05T05:00:00.000Z", synced_at: "2026-10-05T05:00:00.000Z" };
    state.records = [{ ...stored }];
    useIdenticalCsv("日付,感想,睡眠\n10/5,rest,8");
    expect(await runSheetSync(admin, { includeToday: false })).toMatchObject({ inserted: 0, updated: 0, failedMembers: [] });
    expect(state.records).toEqual([stored]);
    keepSuccessfulImports();
    vi.setSystemTime(new Date("2026-10-08T15:00:00.000Z"));
    expect(await runSheetSync(admin, { includeToday: false })).toMatchObject({ inserted: 0, updated: 0, failedMembers: [] });
    expect(state.fetch.mock.calls.at(-1)?.[0][0].forceParse).toBe(true);
    expect(state.writes.filter(write => write.table === "practice_records")).toEqual([]);
    expect(state.records).toEqual([stored]);
  });

  it("rechecks an identical CSV when a future day becomes eligible, while skipping same-day repeats", async () => {
    vi.setSystemTime(new Date("2026-10-08T03:00:00.000Z"));
    state.profiles = [{ ...profile("sheet"), sheet_history_imported_at: "2026-10-01T00:00:00.000Z" }];
    const csv = "日付,感想\n10/8,first day\n10/9,next day";
    useIdenticalCsv(csv);
    const first = await runSheetSync(admin);
    expect(first.inserted).toBe(1);
    const inserted = state.writes.find(write => write.table === "practice_records" && write.op === "insert")?.value as Record<string, unknown>[];
    expect(inserted.map(row => row.recorded_date)).toEqual(["2026-10-08"]);
    state.records = inserted.map((row, index) => ({ ...row, id: `import-${index}` }));
    state.syncStates = state.writes.find(write => write.table === "sheet_member_sync_state" && write.op === "upsert")?.value as Record<string, unknown>[];
    state.writes = [];
    const repeated = await runSheetSync(admin);
    expect(repeated).toMatchObject({ inserted: 0, updated: 0, unchangedMembers: ["B1 test"] });
    expect(state.fetch.mock.calls.at(-1)?.[0][0].forceParse).toBe(false);
    expect(state.writes.filter(write => write.table === "practice_records")).toEqual([]);
    vi.setSystemTime(new Date("2026-10-09T03:00:00.000Z"));
    const nextDay = await runSheetSync(admin);
    expect(nextDay).toMatchObject({ inserted: 1, updated: 0 });
    expect(state.fetch.mock.calls.at(-1)?.[0][0].forceParse).toBe(true);
    expect(state.writes.find(write => write.table === "practice_records" && write.op === "insert")?.value).toEqual([
      expect.objectContaining({ recorded_date: "2026-10-09", created_at: "2026-10-09T03:00:00.000Z", from_sheet: true }),
    ]);
  });

  it("publishes yesterday at JST midnight and imports the next eligible day from unchanged CSV the following night", async () => {
    vi.setSystemTime(new Date("2026-10-07T15:00:00.000Z")); // 10/8 00:00 JST
    state.profiles = [{ ...profile("sheet"), sheet_history_imported_at: "2026-10-01T00:00:00.000Z" }];
    useIdenticalCsv("日付,感想\n10/7,yesterday\n10/8,prefilled today\n10/9,prefilled future");
    const first = await runSheetSync(admin, { includeToday: false });
    expect(first).toMatchObject({ inserted: 1, updated: 0 });
    expect(state.writes.find(write => write.table === "practice_records" && write.op === "insert")?.value).toEqual([
      expect.objectContaining({ recorded_date: "2026-10-07", created_at: "2026-10-07T14:59:59.999Z" }),
    ]);
    keepSuccessfulImports();
    expect(await runSheetSync(admin, { includeToday: false })).toMatchObject({ inserted: 0, updated: 0, unchangedMembers: ["B1 test"] });
    expect(state.writes.filter(write => write.table === "practice_records")).toEqual([]);
    vi.setSystemTime(new Date("2026-10-08T15:00:00.000Z")); // 10/9 00:00 JST
    const nextNight = await runSheetSync(admin, { includeToday: false });
    expect(nextNight).toMatchObject({ inserted: 1, updated: 0 });
    expect(state.fetch.mock.calls.at(-1)?.[0][0].forceParse).toBe(true);
    expect(state.writes.find(write => write.table === "practice_records" && write.op === "insert")?.value).toEqual([
      expect.objectContaining({ recorded_date: "2026-10-08", created_at: "2026-10-08T14:59:59.999Z" }),
    ]);
  });

  it("allows an explicit same-day manual pull after cron with the same CSV", async () => {
    vi.setSystemTime(new Date("2026-10-07T15:00:00.000Z"));
    state.profiles = [{ ...profile("sheet"), sheet_history_imported_at: "2026-10-01T00:00:00.000Z" }];
    useIdenticalCsv("日付,感想\n10/7,yesterday\n10/8,today\n10/9,future");
    await runSheetSync(admin, { includeToday: false });
    keepSuccessfulImports();
    expect(await runSheetSync(admin, { includeToday: true })).toMatchObject({ inserted: 1, updated: 0 });
    expect(state.fetch.mock.calls.at(-1)?.[0][0].forceParse).toBe(true);
    expect(state.writes.find(write => write.table === "practice_records" && write.op === "insert")?.value).toEqual([
      expect.objectContaining({ recorded_date: "2026-10-08", created_at: "2026-10-07T15:00:00.000Z" }),
    ]);
  });

  it("keeps today's pending app pushes, queued clears, and reply reconciliation active during a prior-day cron pull", async () => {
    vi.setSystemTime(new Date("2026-10-07T15:00:00.000Z"));
    state.profiles = [profile("sheet"), { ...profile("sheet", "second"), sheet_name: "B2 test" }];
    state.records = [{ id: "today-app", user_id: "regular", recorded_date: "2026-10-08", memo: "app entry", from_sheet: false, pending_sheet_push: true }];
    state.clears = [{ user_id: "second", recorded_date: "2026-10-08" }];
    useIdenticalCsv("日付,感想\n10/7,yesterday\n10/8,old sheet value\n10/9,future");
    const result = await runSheetSync(admin, { includeToday: false });
    expect(result).toMatchObject({ inserted: 2, updated: 0, pushed: 2 });
    expect(state.gas).toHaveBeenCalledWith(expect.objectContaining({ memberName: "B1 test", date: "2026-10-08", cells: { 感想: "app entry" } }));
    expect(state.gas).toHaveBeenCalledWith(expect.objectContaining({ memberName: "B2 test", date: "2026-10-08", cells: { 感想: "" } }));
    expect(state.replies.mock.calls.at(-1)?.[4]).toBe("2026-10-08");
    expect(state.writes.filter(write => write.table === "practice_records" && write.op === "insert").flatMap(write => write.value as Record<string, unknown>[]).map(row => row.recorded_date)).toEqual(["2026-10-07", "2026-10-07"]);
  });

  it("timestamps only new imports at their batch time and keeps a changed sheet post in its original position", async () => {
    state.profiles = [{ ...profile("sheet"), sheet_history_imported_at: "2026-09-30T00:00:00.000Z" }];
    state.records = [{ id: "existing", user_id: "regular", recorded_date: "2026-09-30", memo: "before", from_sheet: true, created_at: "2026-09-30T05:00:00.000Z" }];
    const result = await runSheetSync(admin);
    expect(result.updated).toBe(1);
    const changed = state.writes.find(w => w.table === "practice_records" && w.op === "update")?.value;
    expect(changed).toEqual({ memo: "旧", synced_at: "2026-10-02T03:00:00.000Z" });
    expect(state.records[0]).toMatchObject({ memo: "旧", from_sheet: true, created_at: "2026-09-30T05:00:00.000Z" });
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
    state.records[0].pending_sheet_push = true; // A later app edit needs another write-through.
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
