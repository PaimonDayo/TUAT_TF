import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const state = vi.hoisted(() => ({
  profiles: [] as Record<string, unknown>[],
  records: [] as Record<string, unknown>[],
  clears: [] as Record<string, unknown>[],
  writes: [] as { table: string; op: string; value: unknown }[],
  readError: null as { message: string } | null,
  lostInsertResponse: false,
  applyBeforeLostResponse: true,
  rejectedProfile: null as string | null,
  fetch: vi.fn(), gas: vi.fn(), replies: vi.fn(), flush: vi.fn(),
}));
vi.mock("./gas-client", () => ({ fetchAllRaw: state.fetch, gasPost: state.gas }));
vi.mock("./replies", () => ({ reconcileSheetReplies: state.replies }));
vi.mock("./reply-deletions", () => ({ flushReplyDeletions: state.flush }));
import { runSheetSync } from "./run";

function linkedProfile(id = "member") {
  return {
    id, sheet_name: `sheet-${id}`, record_fields: [], record_source: "sheet",
    sheet_header_signature: null, sheet_history_imported_at: null,
    sheet_transition: { version: "2026-10", mode: "sheet", confirmed_at: "2026-10-01", legacy: { sheet_name: "old", record_fields: [], record_source: "sheet", sheet_header_signature: null } },
  };
}

const admin = { from(table: string) {
  let op = "select";
  let columns = "";
  let value: unknown;
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  const query = {
    select: (selected: string) => { columns = selected; return query; },
    order: () => query, range: () => query,
    in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
    eq: (key: string, expected: unknown) => { filters.push(row => row[key] === expected); return query; },
    is: (key: string, expected: unknown) => { filters.push(row => expected === null ? row[key] == null : row[key] === expected); return query; },
    gte: (key: string, expected: string) => { filters.push(row => String(row[key]) >= expected); return query; },
    insert: (inserted: unknown) => { op = "insert"; value = inserted; return query; },
    update: (patch: unknown) => { op = "update"; value = patch; return query; },
    upsert: (rows: unknown) => { op = "upsert"; value = rows; return query; },
    delete: () => { op = "delete"; return query; },
    then(resolve: (result: unknown) => void) {
      if (op !== "select") state.writes.push({ table, op, value });
      if (table === "practice_records" && op === "select" && columns.includes("from_sheet") && state.readError) {
        return Promise.resolve({ data: null, error: state.readError }).then(resolve);
      }
      const source = table === "profiles" ? state.profiles : table === "practice_records" ? state.records : table === "sheet_pending_clears" ? state.clears : [];
      const rows: Record<string, unknown>[] = source.map(row => ({ updated_at: null, pending_sheet_push: false, ...row })).filter(row => filters.every(filter => filter(row)));
      if (op === "insert" && table === "practice_records") {
        const inserted = (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
        if (inserted.some(row => row.user_id === state.rejectedProfile)) {
          return Promise.resolve({ data: null, error: { code: "22P02", message: "invalid synthetic value" } }).then(resolve);
        }
        if (inserted.some(row => state.records.some(saved => saved.user_id === row.user_id && saved.recorded_date === row.recorded_date))) {
          return Promise.resolve({ data: null, error: { code: "23505", message: "existing member/date" } }).then(resolve);
        }
        if (Array.isArray(value) && state.lostInsertResponse && !state.applyBeforeLostResponse) {
          state.lostInsertResponse = false;
          return Promise.resolve({ data: null, error: { code: "", message: "TypeError: fetch failed" } }).then(resolve);
        }
        state.records.push(...inserted.map((row, index) => ({ ...row, id: `import-${state.records.length + index}` })));
        if (Array.isArray(value) && state.lostInsertResponse) {
          state.lostInsertResponse = false;
          return Promise.resolve({ data: null, error: { code: "", message: "TypeError: fetch failed" } }).then(resolve);
        }
      }
      if (op === "update") {
        for (const row of rows) {
          const saved = source.find(item => item.id === row.id);
          if (saved) Object.assign(saved, value);
        }
      }
      return Promise.resolve({ data: op === "select" || op === "update" ? rows : [], error: null }).then(resolve);
    },
  };
  return query;
} } as unknown as SupabaseClient;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T15:00:00Z"));
  state.profiles = [linkedProfile()]; state.records = []; state.clears = []; state.writes = [];
  state.readError = null; state.lostInsertResponse = false; state.applyBeforeLostResponse = true; state.rejectedProfile = null;
  state.gas.mockReset().mockResolvedValue({ success: true });
  state.replies.mockReset().mockResolvedValue({ synced: 0, failedMembers: [] });
  state.flush.mockReset().mockResolvedValue([]);
  state.fetch.mockReset().mockImplementation(async (profiles: { name: string }[]) => ({
    members: profiles.map(profile => ({ name: profile.name, header: ["日付", "感想"], records: [{ date: "2026-10-08", cells: { 感想: "sheet content" } }] })),
    signatures: new Map(profiles.map(profile => [profile.name, "synthetic-signature"])), unchangedMembers: [], failedMembers: [],
  }));
});
afterEach(() => vi.useRealTimers());

describe("practice-record synchronization integrity", () => {
  it.each([true, false])("does not resend an insert with a lost acknowledgement and reconciles the next pull, committed=%s", async (committed) => {
    state.lostInsertResponse = true;
    state.applyBeforeLostResponse = committed;
    const first = await runSheetSync(admin, { skipSheetWrites: true });
    expect(first.inserted).toBe(0);
    expect(first.failedMembers).toEqual([{ member: "sheet-member", reason: expect.stringContaining("保存結果") }]);
    expect(state.writes.filter(write => write.table === "practice_records" && write.op === "insert")).toHaveLength(1);
    expect(state.writes.some(write => write.table === "sheet_member_sync_state" || write.table === "profiles")).toBe(false);
    expect(state.records).toHaveLength(committed ? 1 : 0);
    const saved = { ...state.records[0] };
    state.writes = [];

    const repeated = await runSheetSync(admin, { skipSheetWrites: true });
    expect(repeated).toMatchObject({ inserted: committed ? 0 : 1, updated: 0, failedMembers: [] });
    expect(state.records).toHaveLength(1);
    if (committed) {
      expect(state.records).toEqual([saved]);
      expect(state.writes.some(write => write.table === "practice_records")).toBe(false);
    } else {
      expect(state.records[0]).toMatchObject({ recorded_date: "2026-10-08", memo: "sheet content" });
      expect(state.writes.filter(write => write.table === "practice_records" && write.op === "insert")).toHaveLength(1);
    }
  });

  it("isolates a confirmed rejected row so other members can still import", async () => {
    state.profiles = [linkedProfile("good"), linkedProfile("bad")];
    state.rejectedProfile = "bad";
    const result = await runSheetSync(admin, { skipSheetWrites: true });
    expect(result).toMatchObject({ inserted: 1, updated: 0 });
    expect(result.failedMembers).toEqual([{ member: "sheet-bad", reason: expect.stringContaining("invalid synthetic value") }]);
    expect(state.records).toEqual([expect.objectContaining({ user_id: "good", memo: "sheet content" })]);
  });

  it("holds all writes when the existing-record read fails and recovers by updating the original record", async () => {
    state.records = [{ id: "original-id", user_id: "member", recorded_date: "2026-10-08", memo: "old content", from_sheet: true, created_at: "2026-10-08T01:00:00Z", likes_count: 7, comments_count: 2 }];
    state.readError = { message: "record read failed" };
    const failed = await runSheetSync(admin, { skipSheetWrites: true });
    expect(failed).toMatchObject({ inserted: 0, updated: 0, failedMembers: [{ member: "sheet-member" }] });
    expect(state.writes).toEqual([]);
    expect(state.fetch).not.toHaveBeenCalled();

    state.readError = null;
    expect(await runSheetSync(admin, { skipSheetWrites: true })).toMatchObject({ inserted: 0, updated: 1, failedMembers: [] });
    expect(state.records).toEqual([expect.objectContaining({ id: "original-id", recorded_date: "2026-10-08", memo: "sheet content", created_at: "2026-10-08T01:00:00Z", from_sheet: true, likes_count: 7, comments_count: 2 })]);
    state.writes = [];
    expect(await runSheetSync(admin, { skipSheetWrites: true })).toMatchObject({ inserted: 0, updated: 0, failedMembers: [] });
    expect(state.writes.some(write => write.table === "practice_records")).toBe(false);
  });

  it("does not resurrect a deleted record while its sheet clear is pending, including repeated pulls", async () => {
    state.clears = [{ user_id: "member", recorded_date: "2026-10-08" }];
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await runSheetSync(admin, { skipSheetWrites: true })).toMatchObject({ inserted: 0, updated: 0, pushed: 0, failedMembers: [] });
    }
    expect(state.records).toEqual([]);
    expect(state.clears).toEqual([{ user_id: "member", recorded_date: "2026-10-08" }]);
    expect(state.writes.some(write => write.table === "practice_records" || write.table === "sheet_pending_clears")).toBe(false);
  });
});
