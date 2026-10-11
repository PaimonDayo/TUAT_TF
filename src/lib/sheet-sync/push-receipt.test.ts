import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const gas = vi.hoisted(() => vi.fn());
vi.mock("./gas-client", () => ({ gasPost: gas }));
import { beginPushAttempt, listActivePushReceipts, pushFingerprint, pushProfileSnapshot, resolvePendingClear,
  CLEAR_CONTRACT_VERSION, clearIfExistingWithReceipt, writeCellsIdentity, writeCellsTargetSlot, writeCellsWithReceipt, type ActivePushReceipt, type PushAttemptInput } from "./push-receipt";

const profileId = "11111111-1111-4111-8111-111111111111";
const recordId = "22222222-2222-4222-8222-222222222222";
const heldId = "33333333-3333-4333-8333-333333333333";
const snapshot = { sheet_name: "B1 synthetic", record_fields: [], sheet_transition: null, sheet_header_signature: null, record_source: "sheet" };
const target = { sheetName: "B1 synthetic", spreadsheetId: "synthetic-book", fields: [], columns: [{ index: 0, label: "日付" }, { index: 1, label: "感想" }] };
const input = { kind: "record" as const, recordId, profileId, date: "2026-10-10", expectedVersion: "2026-10-10T01:00:00Z", expectedProfile: snapshot };
const cells = { 感想: "synthetic input" };
function client(rpc: ReturnType<typeof vi.fn>, read = vi.fn().mockResolvedValue({ data: null, error: null })) {
  const from = vi.fn(() => {
    const query = { select: () => query, eq: () => query, maybeSingle: read };
    return query;
  });
  return { admin: { rpc, from } as unknown as SupabaseClient, from, read };
}
beforeEach(() => { vi.stubEnv("SHEET_SYNC_GAS_URL", "https://gas.example.test/synthetic/exec"); gas.mockReset().mockResolvedValue({ success: true, action: "updated" }); });
afterEach(() => vi.unstubAllEnvs());

describe("authoritative clear-if-existing receipt", () => {
  const clearInput = { ...input, kind: "clear" as const, recordId: null };
  const metadata = { contractVersion: CLEAR_CONTRACT_VERSION, spreadsheetId: target.spreadsheetId, sheetId: "7", sheetName: target.sheetName,
    headerRow: 1, columns: target.columns };
  function acknowledge(body: Record<string, unknown>, changes: Record<string, unknown> = {}) {
    return { success: true, action: "clearIfExisting", contractVersion: CLEAR_CONTRACT_VERSION, attemptId: body.attemptId,
      spreadsheetId: body.spreadsheetId, sheetId: body.expectedSheetId, sheetName: body.expectedSheetName, date: body.date,
      outcome: "cleared", row: 2, clearedColumns: [1], unmapped: [], protectedHeaders: [], ...changes };
  }
  function provider(changes: Record<string, unknown> = {}) {
    gas.mockImplementation(async body => body.action === "fetchMember" ? { clearTarget: metadata } : acknowledge(body, changes));
  }
  function rpcFixture(finish: Record<string, unknown> = { outcome: "completed", marker_status: "applied" }) {
    return vi.fn().mockImplementation(async (name, args) => ({ data: name === "sheet_push_begin"
      ? { outcome: "send", attempt_id: args.p_attempt_id, marker_status: "pending" } : finish, error: null }));
  }
  const mutationCalls = () => gas.mock.calls.filter(([body]) => body.action === "clearIfExisting");
  const readCalls = () => gas.mock.calls.filter(([body]) => body.action === "fetchMember");
  const clear = (rpc: ReturnType<typeof vi.fn>, changes: Partial<typeof clearInput> = {}) => clearIfExistingWithReceipt(client(rpc).admin, { ...clearInput, ...changes }, target, []);

  it.each(["cleared", "missing"])("finishes a strictly bound authoritative %s ACK with one mutation", async outcome => {
    provider(outcome === "missing" ? { outcome, row: null, clearedColumns: [] } : {});
    const rpc = rpcFixture();
    expect(await clear(rpc)).toMatchObject({ outcome, receipt: { outcome: "completed", marker_status: "applied" } });
    expect(readCalls()).toHaveLength(1); expect(mutationCalls()).toHaveLength(1);
    const binding = rpc.mock.calls[0][1], body = mutationCalls()[0][0];
    expect(binding.p_payload_sha256).toBe(pushFingerprint(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "attemptId"))));
    expect(binding.p_payload_sha256).not.toBe(writeCellsIdentity(target, input.date, { 感想: "" }).payloadSha256);
    expect(rpc.mock.calls[1]).toEqual(["sheet_push_finish", { p_attempt_id: body.attemptId, p_target_fingerprint: binding.p_target_fingerprint,
      p_payload_sha256: binding.p_payload_sha256, p_provider_complete: true }]);
  });
  it("rejects old metadata or a wrong actual workbook before reservation and mutation", async () => {
    const rpc = rpcFixture();
    for (const response of [{ data: { header: ["日付", "感想"] } }, { clearTarget: { ...metadata, spreadsheetId: "wrong_book" } },
      { clearTarget: { ...metadata, contractVersion: "old" } }]) {
      gas.mockResolvedValueOnce(response); await expect(clear(rpc)).rejects.toThrow();
    }
    expect(readCalls()).toHaveLength(3); expect(mutationCalls()).toHaveLength(0); expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps an ambiguous begin even when its single read appears sendable", async () => {
    provider(); const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "synthetic begin lost" } });
    const fixture = client(rpc, vi.fn().mockResolvedValue({ data: { state: "reserved", outcome: "send" }, error: null }));
    await expect(clearIfExistingWithReceipt(fixture.admin, clearInput, target, [])).rejects.toMatchObject({ code: "SHEET_PUSH_BEGIN_UNCONFIRMED", retryable: false });
    expect(fixture.read).toHaveBeenCalledOnce(); expect(readCalls()).toHaveLength(1); expect(mutationCalls()).toHaveLength(0);
  });
  it.each([{ action: "updated" }, { attemptId: heldId }, { sheetId: "8" }, { spreadsheetId: "wrong" }, { contractVersion: "old" },
    { clearedColumns: [] }, { outcome: "missing", row: null }, { protectedHeaders: ["感想"] }, { row: 1 }])("holds a malformed or wrong-binding ACK %j", async change => {
    provider(change); const rpc = rpcFixture();
    await expect(clear(rpc)).rejects.toMatchObject({ code: "SHEET_WRITE_RESULT_UNKNOWN", retryable: false, resultUnknown: true });
    expect(mutationCalls()).toHaveLength(1); expect(rpc).toHaveBeenCalledOnce();
  });
  it("holds requested protected formula cells as a known partial", async () => {
    provider({ outcome: "partial", clearedColumns: [], protectedHeaders: ["感想"] }); const rpc = rpcFixture({ outcome: "confirmed", marker_status: "partial" });
    expect(await clear(rpc)).toMatchObject({ outcome: "partial", receipt: { outcome: "confirmed", marker_status: "partial" } });
    expect(rpc.mock.calls[1][1].p_provider_complete).toBe(false); expect(mutationCalls()).toHaveLength(1);
  });
  it("preserves a newer edit when full clear finish returns superseded", async () => {
    provider(); const rpc = rpcFixture({ outcome: "completed", marker_status: "superseded" });
    expect(await clear(rpc)).toMatchObject({ receipt: { marker_status: "superseded" } }); expect(mutationCalls()).toHaveLength(1);
  });
  it("holds unknown mutation and known success with unknown finish across restart, before even metadata", async () => {
    for (const unknownFinish of [false, true]) {
      provider(); const rpc = rpcFixture();
      if (unknownFinish) rpc.mockImplementation(async (name, args) => name === "sheet_push_begin"
        ? { data: { outcome: "send", attempt_id: args.p_attempt_id, marker_status: "pending" }, error: null } : { data: null, error: { message: "synthetic lost finish" } });
      else gas.mockImplementation(async body => { if (body.action === "clearIfExisting") throw new Error("synthetic lost mutation"); return { clearTarget: metadata }; });
      await expect(clear(rpc)).rejects.toMatchObject({ code: unknownFinish ? "SHEET_SENT_MARKER_UNCONFIRMED" : "SHEET_WRITE_RESULT_UNKNOWN", retryable: false });
      const active: ActivePushReceipt[] = [{ attempt_id: rpc.mock.calls[0][1].p_attempt_id, state: "reserved", profile_id: profileId,
        recorded_date: input.date, record_id: null, target_slot: writeCellsTargetSlot(target.sheetName, input.date, target.spreadsheetId) }];
      gas.mockClear(); rpc.mockClear();
      await expect(clearIfExistingWithReceipt(client(rpc).admin, clearInput, target, active)).rejects.toMatchObject({ code: "SHEET_PUSH_BLOCKED" });
      expect(gas).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
    }
  });
  it("allows only one concurrent reservation to dispatch a mutation, with separate readonly probes", async () => {
    provider(); let occupied = false;
    const rpc = vi.fn().mockImplementation(async (name, args) => {
      if (name === "sheet_push_finish") return { data: { outcome: "completed", marker_status: "applied" }, error: null };
      const outcome = occupied ? "blocked" : "send"; occupied = true;
      return { data: { outcome, attempt_id: outcome === "send" ? args.p_attempt_id : heldId, marker_status: "pending" }, error: null };
    });
    const results = await Promise.allSettled([clear(rpc), clear(rpc)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(readCalls()).toHaveLength(2); expect(mutationCalls()).toHaveLength(1);
  });
});

describe("durable writeCells dispatch boundary", () => {
  it("sends once then finishes with the exact reserved hashes and provider acknowledgement", async () => {
    const rpc = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => ({ data: name === "sheet_push_begin"
      ? { outcome: "send", attempt_id: args.p_attempt_id, marker_status: "pending" }
      : { outcome: "completed", marker_status: "applied" }, error: null }));
    const { admin } = client(rpc);
    expect(await writeCellsWithReceipt(admin, input, target, cells)).toMatchObject({ receipt: { outcome: "completed", marker_status: "applied" } });
    expect(gas).toHaveBeenCalledOnce();
    const begin = rpc.mock.calls[0][1];
    expect(rpc.mock.calls[1]).toEqual(["sheet_push_finish", { p_attempt_id: begin.p_attempt_id, p_target_fingerprint: begin.p_target_fingerprint,
      p_payload_sha256: begin.p_payload_sha256, p_provider_complete: true }]);
    expect(begin.p_expected_profile).toEqual(snapshot);
  });
  it.each(["network", "malformed"])("holds a %s result across a new caller rather than dispatching again", async failure => {
    const rpc = vi.fn().mockImplementation(async (_name: string, args: Record<string, unknown>) => ({ data: {
      outcome: rpc.mock.calls.length === 1 ? "send" : "blocked", attempt_id: rpc.mock.calls.length === 1 ? args.p_attempt_id : heldId, marker_status: "pending" }, error: null }));
    const { admin } = client(rpc);
    if (failure === "network") gas.mockRejectedValueOnce(new Error("lost synthetic response"));
    else gas.mockResolvedValueOnce({});
    await expect(writeCellsWithReceipt(admin, input, target, cells)).rejects.toMatchObject({ code: "SHEET_WRITE_RESULT_UNKNOWN", retryable: false });
    const restarted = client(rpc).admin;
    await expect(writeCellsWithReceipt(restarted, input, target, cells)).rejects.toMatchObject({ code: "SHEET_PUSH_BLOCKED" });
    expect(gas).toHaveBeenCalledOnce(); expect(rpc.mock.calls.every(call => call[0] === "sheet_push_begin")).toBe(true);
  });
  it("retains known provider success when finish is unknown, and the next caller cannot send", async () => {
    let begun = false;
    const rpc = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "sheet_push_finish") return { data: null, error: { code: "PC_BACKUP_UNAVAILABLE" } };
      const outcome = begun ? "blocked" : "send"; begun = true;
      return { data: { outcome, attempt_id: outcome === "send" ? args.p_attempt_id : heldId, marker_status: "pending" }, error: null };
    });
    await expect(writeCellsWithReceipt(client(rpc).admin, input, target, cells)).rejects.toMatchObject({ code: "SHEET_SENT_MARKER_UNCONFIRMED", externallySent: true, retryable: false });
    await expect(writeCellsWithReceipt(client(rpc).admin, { ...input, expectedVersion: "2026-10-10T02:00:00Z" }, target, { 感想: "edited input" })).rejects.toMatchObject({ code: "SHEET_PUSH_BLOCKED" });
    expect(gas).toHaveBeenCalledOnce(); expect(rpc.mock.calls.filter(call => call[0] === "sheet_push_finish")).toHaveLength(1);
  });
  it("permits only the winning concurrent reservation to dispatch", async () => {
    let occupied = false;
    const rpc = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "sheet_push_finish") return { data: { outcome: "completed", marker_status: "applied" }, error: null };
      const outcome = occupied ? "blocked" : "send"; occupied = true;
      return { data: { outcome, attempt_id: outcome === "send" ? args.p_attempt_id : heldId, marker_status: "pending" }, error: null };
    });
    const admin = client(rpc).admin;
    const results = await Promise.allSettled([writeCellsWithReceipt(admin, input, target, cells), writeCellsWithReceipt(admin, input, target, cells)]);
    expect(results.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]); expect(gas).toHaveBeenCalledOnce();
  });
  it("never grants dispatch from the single read after a lost begin response", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "synthetic lost begin" } });
    const { admin, from, read } = client(rpc, vi.fn().mockResolvedValue({ data: { outcome: "send", state: "reserved" }, error: null }));
    await expect(writeCellsWithReceipt(admin, input, target, cells)).rejects.toMatchObject({ code: "SHEET_PUSH_BEGIN_UNCONFIRMED", retryable: false });
    expect(rpc).toHaveBeenCalledOnce(); expect(from).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce(); expect(gas).not.toHaveBeenCalled();
  });
  it.each(["blocked", "stale", "confirmed", "completed"])("does not send for the existing %s outcome", async outcome => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome, attempt_id: heldId, marker_status: outcome === "completed" ? "applied" : outcome === "confirmed" ? "partial" : "pending" }, error: null });
    const attempt = writeCellsWithReceipt(client(rpc).admin, input, target, cells);
    if (outcome === "completed") expect(await attempt).toMatchObject({ receipt: { outcome: "completed" } });
    else await expect(attempt).rejects.toMatchObject({ retryable: false });
    expect(gas).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledOnce();
  });
  it("records confirmed partial without asserting mapped completeness and holds later dispatch", async () => {
    const rpc = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => ({ data: name === "sheet_push_finish"
      ? { outcome: "confirmed", marker_status: "partial" } : { outcome: "send", attempt_id: args.p_attempt_id, marker_status: "pending" }, error: null }));
    gas.mockResolvedValueOnce({ success: true, action: "updated", unmapped: ["感想"] });
    expect(await writeCellsWithReceipt(client(rpc).admin, input, target, cells)).toMatchObject({ unmapped: ["感想"], receipt: { outcome: "confirmed", marker_status: "partial" } });
    expect(rpc.mock.calls[1][1].p_provider_complete).toBe(false); expect(gas).toHaveBeenCalledOnce();
  });
  it("holds protected requested cells as confirmed partial even when GAS says success", async () => {
    const rpc = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => ({ data: name === "sheet_push_begin"
      ? { outcome: "send", attempt_id: args.p_attempt_id, marker_status: "pending" } : { outcome: "confirmed", marker_status: "partial" }, error: null }));
    gas.mockResolvedValueOnce({ success: true, action: "updated", unmapped: [], protectedHeaders: ["計算式"] });
    expect(await writeCellsWithReceipt(client(rpc).admin, input, target, cells)).toMatchObject({ unmapped: ["計算式"], receipt: { marker_status: "partial" } });
    expect(rpc.mock.calls[1][1].p_provider_complete).toBe(false); expect(gas).toHaveBeenCalledOnce();
  });
  it.each([{ success: true }, { success: true, action: "wrong" }, { success: true, action: "updated", protectedHeaders: [1] }])("holds an invalid provider acknowledgement without finish or retry", async acknowledgement => {
    const rpc = vi.fn().mockImplementation(async (_name: string, args: Record<string, unknown>) => ({ data: { outcome: "send", attempt_id: args.p_attempt_id, marker_status: "pending" }, error: null }));
    gas.mockResolvedValueOnce(acknowledgement);
    await expect(writeCellsWithReceipt(client(rpc).admin, input, target, cells)).rejects.toMatchObject({ code: "SHEET_WRITE_RESULT_UNKNOWN" });
    expect(rpc).toHaveBeenCalledOnce(); expect(gas).toHaveBeenCalledOnce();
  });
  it("preserves a newer edit through a superseded finish instead of running a raw marker update", async () => {
    const rpc = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => ({ data: name === "sheet_push_begin"
      ? { outcome: "send", attempt_id: args.p_attempt_id, marker_status: "pending" } : { outcome: "completed", marker_status: "superseded" }, error: null }));
    const { admin, from } = client(rpc);
    expect(await writeCellsWithReceipt(admin, input, target, cells)).toMatchObject({ receipt: { marker_status: "superseded" } });
    expect(from).not.toHaveBeenCalled(); expect(gas).toHaveBeenCalledOnce();
  });
  it("rejects a send receipt with another attempt ID and a missing timestamp", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "send", attempt_id: heldId, marker_status: "pending" }, error: null });
    await expect(writeCellsWithReceipt(client(rpc).admin, input, target, cells)).rejects.toMatchObject({ code: "SHEET_PUSH_BEGIN_UNCONFIRMED" });
    await expect(beginPushAttempt(client(rpc).admin, { ...input, expectedVersion: "", ...writeCellsIdentity(target, input.date, cells) } as PushAttemptInput)).rejects.toThrow("更新時刻");
    expect(rpc).toHaveBeenCalledOnce(); expect(gas).not.toHaveBeenCalled();
  });
  it("records a confirmed pre-dispatch backup refusal as held, without calling it an external unknown", async () => {
    const rpc = vi.fn().mockImplementation(async (_name: string, args: Record<string, unknown>) => ({ data: { outcome: "send", attempt_id: args.p_attempt_id, marker_status: "pending" }, error: null }));
    gas.mockRejectedValueOnce({ code: "PC_BACKUP_UNAVAILABLE" });
    await expect(writeCellsWithReceipt(client(rpc).admin, input, target, cells)).rejects.toMatchObject({ code: "SHEET_PUSH_BLOCKED", externallySent: false, resultUnknown: false });
    expect(rpc).toHaveBeenCalledOnce();
  });
});

describe("receipt binding and read-only protection", () => {
  it("binds NFC/trim aliases to one slot independently of explicit workbook endpoint aliases", () => {
    const date = "2026-10-10";
    const slot = writeCellsTargetSlot(" B1 カ\u3099 ", date, "synthetic-book");
    vi.stubEnv("SHEET_SYNC_GAS_URL", "https://other.example.test/synthetic/exec");
    expect(writeCellsTargetSlot("B1 ガ", date, "synthetic-book")).toBe(slot);
    expect(writeCellsTargetSlot("B1 ガ", date, "different-book")).not.toBe(slot);
    expect(writeCellsTargetSlot("B1 ガ", "2026-10-11", "synthetic-book")).not.toBe(slot);
  });
  it("binds payload, mapping, columns and exact endpoint while canonical key ordering stays stable", () => {
    const original = writeCellsIdentity(target, input.date, { b: 1, a: "" });
    expect(writeCellsIdentity(target, input.date, { a: "", b: 1 })).toEqual(original);
    expect(writeCellsIdentity(target, input.date, { a: "changed", b: 1 }).payloadSha256).not.toBe(original.payloadSha256);
    expect(writeCellsIdentity({ ...target, columns: [{ index: 2, label: "感想" }] }, input.date, cells).targetFingerprint).not.toBe(original.targetFingerprint);
    vi.stubEnv("SHEET_SYNC_GAS_URL", "https://alias.example.test/exec");
    const alias = writeCellsIdentity(target, input.date, { b: 1, a: "" });
    expect(alias.targetSlot).toBe(original.targetSlot); expect(alias.targetFingerprint).not.toBe(original.targetFingerprint);
  });
  it("does not normalize the five DB profile values or silently omit a missing key", () => {
    const raw = { ...snapshot, record_fields: null, record_source: "app", extra: "ignored" };
    expect(pushProfileSnapshot(raw)).toEqual({ ...snapshot, record_fields: null, record_source: "app" });
    expect(() => pushProfileSnapshot({ sheet_name: "synthetic" })).toThrow("シート設定");
  });
  it("reads beyond the 1000-row API cap and keeps receipts for deleted records", async () => {
    const row: ActivePushReceipt = { attempt_id: heldId, state: "reserved", profile_id: profileId, recorded_date: input.date, record_id: null, target_slot: pushFingerprint("synthetic") };
    const ranges: number[][] = [];
    const admin = { from: (table: string) => {
      expect(table).toBe("sheet_push_attempts");
      const q = { select: () => q, in: () => q, order: () => q, range: async (from: number, to: number) => {
        ranges.push([from, to]); return { data: from === 0 ? Array.from({ length: 1000 }, () => row) : [row], error: null };
      } }; return q;
    } } as unknown as SupabaseClient;
    expect(await listActivePushReceipts(admin)).toHaveLength(1001); expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });
  it.each([{ data: null, error: null }, { data: null, error: { message: "synthetic denied" } }, { data: [{}], error: null }])("fails closed on unavailable or malformed receipt reads", async response => {
    const q = { select: () => q, in: () => q, order: () => q, range: async () => response };
    await expect(listActivePushReceipts({ from: () => q } as unknown as SupabaseClient)).rejects.toThrow(); expect(gas).not.toHaveBeenCalled();
  });
  it("uses a guarded no-provider clear resolution and never claims provider acknowledgement", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "blocked" }, error: null });
    const admin = client(rpc).admin;
    const targetSlot = writeCellsTargetSlot(target.sheetName, input.date, target.spreadsheetId);
    await expect(resolvePendingClear(admin, { profileId, date: input.date, expectedVersion: input.expectedVersion, expectedProfile: snapshot, targetSlot })).rejects.toMatchObject({ code: "SHEET_PUSH_BLOCKED" });
    expect(rpc).toHaveBeenCalledWith("sheet_clear_resolve", { p_profile_id: profileId, p_recorded_date: input.date, p_expected_version: input.expectedVersion, p_expected_profile: snapshot, p_target_slot: targetSlot });
    expect(gas).not.toHaveBeenCalled();
  });
});
