import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OCTOBER_SHEET_ID } from "@/lib/sheet-period";
const state = vi.hoisted(() => ({ admin: null as unknown as SupabaseClient, profiles: [] as Record<string, unknown>[],
  records: [] as Record<string, unknown>[], clears: [] as Record<string, unknown>[], attempts: [] as Record<string, unknown>[],
  writes: [] as { table: string; operation: string; value: unknown }[], gas: vi.fn(), rpc: vi.fn(), receiptError: false,
  finishError: false, beginUnknown: false, readsByAttempt: 0, fetch: vi.fn(), memberRecords: [] as { date: string; cells: Record<string, string> }[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin }));
vi.mock("@/lib/pc-backup-status", async original => ({ ...await original<typeof import("@/lib/pc-backup-status")>(), pcAppWriteProtectionResponse: async () => null }));
vi.mock("@/lib/sheet-sync/gas-client", () => ({ gasPost: state.gas, fetchMemberRaw: async (name: string) => ({ name,
  header: ["日付", "感想"], records: state.memberRecords }), fetchAllRaw: state.fetch }));
vi.mock("@/lib/sheet-sync/reply-deletions", () => ({ flushReplyDeletions: async () => [] }));
vi.mock("@/lib/sheet-sync/replies", () => ({ reconcileSheetReplies: async () => ({ synced: 0, failedMembers: [] }) }));
import { POST } from "./route";
import { runSheetSync } from "@/lib/sheet-sync/run";
import { processPendingClears } from "@/lib/sheet-sync/clear";
import { CLEAR_CONTRACT_VERSION } from "@/lib/sheet-sync/push-receipt";

function gasAcknowledgement(body: Record<string, unknown>) {
  if (body.action === "fetchMember") return { clearTarget: { contractVersion: CLEAR_CONTRACT_VERSION,
    spreadsheetId: body.spreadsheetId ?? "synthetic_legacy_workbook", sheetId: "1", sheetName: body.memberName,
    headerRow: 1, columns: [{ index: 0, label: "日付" }, { index: 1, label: "感想" }] } };
  if (body.action === "clearIfExisting") return { success: true, action: body.action, contractVersion: CLEAR_CONTRACT_VERSION,
    attemptId: body.attemptId, spreadsheetId: body.spreadsheetId, sheetId: body.expectedSheetId, sheetName: body.expectedSheetName,
    date: body.date, outcome: "cleared", row: 2, clearedColumns: [1], unmapped: [], protectedHeaders: [] };
  return { success: true, action: "updated" };
}

const profileId = "11111111-1111-4111-8111-111111111111";
const recordId = "22222222-2222-4222-8222-222222222222";
const request = () => new Request("https://pc-app.example.test/api/sheets/push-record", { method: "POST", body: JSON.stringify({ recordId }) });
function fixtureClient(): SupabaseClient {
  return { rpc: state.rpc, from(table: string) {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let from = 0, to = Infinity;
    let operation = "select", value: unknown;
    const read = () => {
      if (table === "sheet_push_attempts" && state.receiptError) return { data: null, error: { message: "synthetic receipt read failure" } };
      const rows = table === "profiles" ? state.profiles : table === "practice_records" ? state.records
        : table === "sheet_pending_clears" ? state.clears : table === "sheet_push_attempts" ? state.attempts : [];
      const data = rows.filter(row => filters.every(filter => filter(row))).slice(from, to + 1);
      if (operation !== "select") {
        state.writes.push({ table, operation, value });
        if (operation === "insert" && table === "practice_records") state.records.push(...(value as Record<string, unknown>[]));
      }
      return { data: structuredClone(data), error: null };
    };
    const q = { select: () => q, order: () => q, limit: () => q, range: (start: number, end: number) => { from = start; to = end; return q; },
      eq: (key: string, expected: unknown) => { filters.push(row => row[key] === expected); if (table === "sheet_push_attempts" && key === "attempt_id") state.readsByAttempt++; return q; },
      in: (key: string, expected: unknown[]) => { filters.push(row => expected.includes(row[key])); return q; },
      is: (key: string, expected: unknown) => { filters.push(row => row[key] === expected); return q; }, gte: () => q,
      insert: (rows: unknown) => { operation = "insert"; value = rows; return q; },
      update: (patch: unknown) => { operation = "update"; value = patch; return q; },
      upsert: (rows: unknown) => { operation = "upsert"; value = rows; return q; },
      delete: () => { operation = "delete"; return q; },
      maybeSingle: async () => { const result = read(); return { ...result, data: result.data?.[0] ?? null }; },
      single: async () => { const result = read(); return { ...result, data: result.data?.[0] ?? null }; },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve(read()).then(resolve) };
    return q;
  } } as unknown as SupabaseClient;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-11T01:00:00Z"));
  vi.stubEnv("SHEET_SYNC_GAS_URL", "https://gas.example.test/synthetic/exec");
  state.profiles = [{ id: profileId, sheet_name: "B1 synthetic", record_fields: [], record_source: "sheet", sheet_header_signature: null,
    sheet_history_imported_at: "2026-10-01T00:00:00Z", sheet_linked_at: "2026-10-01T00:00:00Z", sheet_transition: { version: "2026-10", mode: "sheet", confirmed_at: "2026-10-01T00:00:00Z",
      legacy: { sheet_name: "B1 legacy", record_fields: [], sheet_header_signature: null, record_source: "sheet" } } }];
  state.records = [{ id: recordId, user_id: profileId, recorded_date: "2026-10-10", memo: "new app input", pending_sheet_push: true,
    updated_at: "2026-10-10T01:00:00Z", synced_at: null, record_fields_snapshot: [] }];
  state.clears = []; state.attempts = []; state.writes = []; state.finishError = false; state.beginUnknown = false; state.receiptError = false; state.readsByAttempt = 0;
  state.memberRecords = [{ date: "2026-10-10", cells: { 感想: "stale CSV input" } }];
  state.gas.mockReset().mockImplementation(async body => gasAcknowledgement(body));
  state.fetch.mockReset().mockImplementation(async (profiles: { name: string }[]) => ({ members: profiles.map(profile => ({ name: profile.name,
    header: ["日付", "感想"], records: [{ date: "2026-10-10", cells: { 感想: "stale CSV input" } }] })), signatures: new Map(), failedMembers: [], unchangedMembers: [] }));
  // This adapter models the finalized RPC outcomes, not SQL authorization or
  // locking. Those are independently proved in the fresh PostgreSQL fixture.
  state.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "sheet_push_begin") {
      const active = state.attempts.find(attempt => attempt.state !== "completed" && (attempt.record_id === args.p_record_id
        || (attempt.profile_id === args.p_profile_id && attempt.recorded_date === args.p_recorded_date) || attempt.target_slot === args.p_target_slot));
      if (active) return { data: { outcome: "blocked", attempt_id: active.attempt_id, marker_status: active.marker_status }, error: null };
      const completed = state.attempts.find(attempt => attempt.state === "completed" && attempt.payload_sha256 === args.p_payload_sha256
        && attempt.target_fingerprint === args.p_target_fingerprint && attempt.record_id === args.p_record_id);
      if (completed) return { data: { outcome: "completed", attempt_id: completed.attempt_id, marker_status: completed.marker_status }, error: null };
      state.attempts.push({ attempt_id: args.p_attempt_id, state: "reserved", kind: args.p_kind, profile_id: args.p_profile_id,
        recorded_date: args.p_recorded_date, record_id: args.p_record_id, target_slot: args.p_target_slot, target_fingerprint: args.p_target_fingerprint,
        payload_sha256: args.p_payload_sha256, expected_version: args.p_expected_version, expected_profile: args.p_expected_profile, marker_status: "pending" });
      return state.beginUnknown ? { data: null, error: { message: "synthetic lost begin response" } }
        : { data: { outcome: "send", attempt_id: args.p_attempt_id, marker_status: "pending" }, error: null };
    }
    if (name === "sheet_clear_resolve") {
      const active = state.attempts.some(attempt => attempt.state !== "completed" && ((attempt.profile_id === args.p_profile_id && attempt.recorded_date === args.p_recorded_date) || attempt.target_slot === args.p_target_slot));
      if (active) return { data: { outcome: "blocked" }, error: null };
      state.clears = state.clears.filter(row => row.user_id !== args.p_profile_id || row.recorded_date !== args.p_recorded_date || row.created_at !== args.p_expected_version);
      return { data: { outcome: "resolved" }, error: null };
    }
    if (state.finishError) return { data: null, error: { code: "PC_BACKUP_UNAVAILABLE" } };
    const attempt = state.attempts.find(row => row.attempt_id === args.p_attempt_id)!;
    if (!args.p_provider_complete) { attempt.state = "confirmed"; attempt.marker_status = "partial"; return { data: { outcome: "confirmed", marker_status: "partial" }, error: null }; }
    const record = state.records.find(row => row.id === attempt.record_id);
    attempt.state = "completed";
    attempt.marker_status = record && record.updated_at !== attempt.expected_version ? "superseded" : "applied";
    if (record && attempt.marker_status === "applied") Object.assign(record, { pending_sheet_push: false, synced_at: new Date().toISOString() });
    if (attempt.kind === "clear") state.clears = state.clears.filter(row => row.user_id !== attempt.profile_id || row.recorded_date !== attempt.recorded_date);
    return { data: { outcome: "completed", marker_status: attempt.marker_status }, error: null };
  });
  state.admin = fixtureClient();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("immediate writeCells followed by the durable planner", () => {
  it("completes the marker atomically and a repeated manual call sends no second request", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(state.records[0].pending_sheet_push).toBe(false);
    expect((await POST(request())).status).toBe(200);
    expect(state.gas).toHaveBeenCalledOnce(); expect(state.writes.some(write => write.table === "practice_records")).toBe(false);
  });
  it.each(["provider-unknown", "finish-unknown", "partial"])("holds %s through restart, record edits/deletion and CSV import", async failure => {
    if (failure === "provider-unknown") state.gas.mockRejectedValueOnce(new Error("synthetic lost GAS response"));
    if (failure === "finish-unknown") state.finishError = true;
    if (failure === "partial") state.gas.mockResolvedValueOnce({ success: true, action: "updated", unmapped: ["感想"] });
    const response = await POST(request());
    expect(response.status).toBe(failure === "finish-unknown" ? 503 : 502);
    expect(await response.json()).toMatchObject({ ok: false, retryable: false, markerConfirmed: false });
    expect(state.records[0].pending_sheet_push).toBe(true);
    state.records[0].updated_at = "2026-10-10T02:00:00Z";
    state.records[0].memo = "newer app edit";
    state.admin = fixtureClient();
    expect(await runSheetSync(state.admin)).toMatchObject({ inserted: 0, updated: 0, pushed: 0, sheetWritesUncertain: true });
    expect(state.records[0].memo).toBe("newer app edit");
    state.records = []; state.clears = []; // Active receipt outlives both rows.
    expect(await runSheetSync(state.admin)).toMatchObject({ inserted: 0, updated: 0, pushed: 0 });
    expect(state.gas).toHaveBeenCalledOnce();
    expect(state.writes.some(write => write.table === "practice_records" || write.table === "sheet_pending_clears")).toBe(false);
  });
  it("retains a moved record and both protected CSV dates", async () => {
    state.gas.mockRejectedValueOnce(new Error("synthetic lost response")); await POST(request());
    Object.assign(state.records[0], { recorded_date: "2026-10-11", updated_at: "2026-10-11T00:00:00Z", memo: "moved app input" });
    state.fetch.mockResolvedValue({ members: [{ name: "B1 synthetic", header: ["日付", "感想"], records: [
      { date: "2026-10-10", cells: { 感想: "old CSV date" } }, { date: "2026-10-11", cells: { 感想: "new CSV date" } }] }], signatures: new Map(), failedMembers: [], unchangedMembers: [] });
    expect(await runSheetSync(state.admin)).toMatchObject({ inserted: 0, updated: 0, pushed: 0 });
    expect(state.records[0].memo).toBe("moved app input"); expect(state.gas).toHaveBeenCalledOnce();
  });
  it("keeps a newer edit pending when known delivery is superseded", async () => {
    state.gas.mockImplementationOnce(async () => { Object.assign(state.records[0], { updated_at: "2026-10-10T02:00:00Z", memo: "newer app edit" }); return { success: true, action: "updated" }; });
    const response = await POST(request()); expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ outcome: "partial", externallySent: true, retryable: false, result: { receipt: { marker_status: "superseded" } } });
    expect(state.records[0]).toMatchObject({ memo: "newer app edit", pending_sheet_push: true }); expect(state.gas).toHaveBeenCalledOnce();
  });
  it("does not dispatch after lost begin acknowledgement even when its one read finds the reserved row", async () => {
    state.beginUnknown = true; const response = await POST(request());
    expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ code: "SHEET_PUSH_BEGIN_UNCONFIRMED", retryable: false });
    expect(state.readsByAttempt).toBe(1); expect(state.attempts).toHaveLength(1); expect(state.gas).not.toHaveBeenCalled();
    expect(await runSheetSync(state.admin)).toMatchObject({ pushed: 0 }); expect(state.gas).not.toHaveBeenCalled();
  });
  it("fails closed before CSV/provider work when the active receipt list is unavailable, including dry run", async () => {
    state.receiptError = true;
    await expect(runSheetSync(state.admin, { dryRun: true })).rejects.toThrow("未確認の送信状態");
    await expect(runSheetSync(state.admin)).rejects.toThrow("未確認の送信状態");
    expect(state.fetch).not.toHaveBeenCalled(); expect(state.gas).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled(); expect(state.writes).toHaveLength(0);
  });
  it("reads and excludes an unresolved receipt in dry run without a reservation or provider mutation", async () => {
    state.beginUnknown = true; await POST(request()); state.rpc.mockClear();
    expect(await runSheetSync(state.admin, { dryRun: true })).toMatchObject({ inserted: 0, updated: 0, pushed: 0, dryRun: true });
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.gas).not.toHaveBeenCalled(); expect(state.writes).toHaveLength(0);
  });
  it("does not claim a provider success or clear pending when no mapped cells exist", async () => {
    state.gas.mockClear(); state.records[0].record_fields_snapshot = [{ key: "memo", label: "感想", type: "text", hidden: true }];
    const response = await POST(request()); expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ outcome: "partial", externallySent: false, result: { receipt: null } });
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.gas).not.toHaveBeenCalled(); expect(state.records[0].pending_sheet_push).toBe(true);
    expect(await runSheetSync(state.admin)).toMatchObject({ inserted: 0, updated: 0, pushed: 0,
      failedMembers: [expect.objectContaining({ reason: expect.stringContaining("書き込める入力項目") })] });
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.gas).not.toHaveBeenCalled(); expect(state.records[0].pending_sheet_push).toBe(true);
  });
  it("keeps unresolved clear queues even when a record was recreated or CSV now appears empty", async () => {
    state.gas.mockRejectedValueOnce(new Error("synthetic lost response")); await POST(request());
    state.clears = [{ user_id: profileId, recorded_date: "2026-10-10", created_at: "2026-10-10T03:00:00Z" }];
    const result = await processPendingClears(state.admin, { id: profileId, sheet_name: "B1 synthetic", record_fields: [] });
    expect(result).toEqual({ cleared: 0, failed: 1 }); expect(state.clears).toHaveLength(1);
    expect(state.gas).toHaveBeenCalledOnce(); expect(state.writes.some(write => write.operation === "delete")).toBe(false);
  });
  it("binds the October workbook explicitly in every dispatched write", async () => {
    await POST(request()); expect(state.gas).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: OCTOBER_SHEET_ID }));
    const begin = state.rpc.mock.calls.find(call => call[0] === "sheet_push_begin")![1];
    expect(begin.p_expected_profile).toEqual({ sheet_name: state.profiles[0].sheet_name, record_fields: [], sheet_transition: state.profiles[0].sheet_transition,
      sheet_header_signature: null, record_source: "sheet" });
  });
  it("confirms actual clear despite empty stale CSV, and never imports that queued date first", async () => {
    state.records = []; state.memberRecords = [];
    state.clears = [{ user_id: profileId, recorded_date: "2026-10-10", created_at: "2026-10-10T03:00:00Z" }];
    state.fetch.mockResolvedValue({ members: [{ name: "B1 synthetic", header: ["日付", "感想"], records: [] }], signatures: new Map(), failedMembers: [], unchangedMembers: [] });
    expect(await runSheetSync(state.admin)).toMatchObject({ inserted: 0, updated: 0, pushed: 1, failedMembers: [] });
    expect(state.clears).toHaveLength(0);
    expect(state.gas.mock.calls.filter(([body]) => body.action === "fetchMember")).toHaveLength(1);
    expect(state.gas.mock.calls.filter(([body]) => body.action === "clearIfExisting")).toHaveLength(1);
    expect(state.rpc.mock.calls.at(-1)).toEqual(["sheet_push_finish", expect.objectContaining({ p_provider_complete: true })]);
    expect(state.writes.some(write => write.operation === "delete")).toBe(false);
  });
  it("holds an unknown clear across the immediate caller and the next planner run", async () => {
    state.records = []; state.clears = [{ user_id: profileId, recorded_date: "2026-10-10", created_at: "2026-10-10T03:00:00Z" }];
    state.gas.mockImplementation(async body => { if (body.action === "clearIfExisting") throw new Error("synthetic lost clear response"); return gasAcknowledgement(body); });
    expect(await processPendingClears(state.admin, { id: profileId, sheet_name: "B1 synthetic", record_fields: [] })).toEqual({ cleared: 0, failed: 1 });
    state.admin = fixtureClient();
    expect(await runSheetSync(state.admin)).toMatchObject({ inserted: 0, updated: 0, pushed: 0, sheetWritesUncertain: true });
    expect(state.clears).toHaveLength(1); expect(state.attempts[0]).toMatchObject({ kind: "clear", state: "reserved" });
    expect(state.gas.mock.calls.filter(([body]) => body.action === "fetchMember")).toHaveLength(1);
    expect(state.gas.mock.calls.filter(([body]) => body.action === "clearIfExisting")).toHaveLength(1);
    expect(state.writes.some(write => write.operation === "delete")).toBe(false);
  });
  it("removes a clear queue only in the acknowledged finish RPC", async () => {
    state.records = []; state.clears = [{ user_id: profileId, recorded_date: "2026-10-10", created_at: "2026-10-10T03:00:00Z" }];
    expect(await processPendingClears(state.admin, { id: profileId, sheet_name: "B1 synthetic", record_fields: [] })).toEqual({ cleared: 1, failed: 0 });
    expect(state.clears).toHaveLength(0);
    expect(state.gas.mock.calls.filter(([body]) => body.action === "fetchMember")).toHaveLength(1);
    expect(state.gas.mock.calls.filter(([body]) => body.action === "clearIfExisting")).toHaveLength(1);
    expect(state.rpc.mock.calls.at(-1)).toEqual(["sheet_push_finish", expect.objectContaining({ p_provider_complete: true })]);
    expect(state.writes.some(write => write.operation === "delete")).toBe(false);
  });
  it("resolves a recreated record with its version/profile/slot guard and no provider acknowledgement", async () => {
    state.clears = [{ user_id: profileId, recorded_date: "2026-10-10", created_at: "2026-10-10T03:00:00Z" }];
    expect(await processPendingClears(state.admin, { id: profileId, sheet_name: "B1 synthetic", record_fields: [] })).toEqual({ cleared: 0, failed: 0 });
    expect(state.clears).toHaveLength(0); expect(state.gas).not.toHaveBeenCalled(); expect(state.rpc).toHaveBeenCalledOnce();
    expect(state.rpc).toHaveBeenCalledWith("sheet_clear_resolve", expect.objectContaining({ p_expected_version: "2026-10-10T03:00:00Z", p_target_slot: expect.stringMatching(/^[0-9a-f]{64}$/) }));
  });
});
