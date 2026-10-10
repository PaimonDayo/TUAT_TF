vi.mock("@/lib/ob-results-notify", () => ({ scheduleObResultsPublish: vi.fn() }));
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), roles: vi.fn(), preview: vi.fn(), rpc: vi.fn(), refresh: vi.fn(), profile: vi.fn(), read: vi.fn(), reads: [] as { table: string; select: string; filters: [string, string][] }[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, rpc: mocks.rpc, from: (table: string) => {
  const read = { table, select: "", filters: [] as [string, string][] };
  const query = {
    select(columns: string) { read.select = columns; return query; },
    eq(column: string, value: string) { read.filters.push([column, value]); return query; },
    maybeSingle() { mocks.reads.push(read); return table === "profiles" ? mocks.profile() : mocks.read(); },
  };
  return query;
} }) }));
vi.mock("@/lib/supabase/auth", () => ({ fetchRolesByProfileIds: mocks.roles, isMemberPreviewActive: mocks.preview }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { addObDayEntry, checkObEventOperation, saveObEventOperation, setObAttendance } from "./operations-actions";
import { emptyPerformance, type MeetEventData } from "@/lib/meet-operations";

const entryId = "10000000-0000-4000-8000-000000000001";
const operationId = "20000000-0000-4000-8000-000000000001";
const input = { event: "男子100m", revision: null, data: { confirmed: false, participants: [] } as MeetEventData };
const stored = (data = input.data) => ({ meet_key: "ob-2026", event_name: input.event, revision: 0, data, updated_at: "2026-10-04T00:00:00Z" });
const staff = [{ name: "OB戦2026", can_manage_system: false }];
const dayInput = { operationId, event: input.event, entryId, revision: 3, group: 1 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: "u" } } });
  mocks.preview.mockResolvedValue(false);
  mocks.roles.mockResolvedValue(new Map([["u", [{ name: "system", can_manage_system: true }]]]));
  mocks.rpc.mockResolvedValue({ data: stored(), error: null });
  mocks.profile.mockResolvedValue({data:null,error:null});
  mocks.read.mockResolvedValue({data:null,error:null});
  mocks.reads = [];
});
it("permits OB staff and system operators but rejects anonymous, unverified profiles and preview access", async () => {
  mocks.user.mockResolvedValueOnce({ data: { user: null } });
  expect((await saveObEventOperation(input)).ok).toBe(false);
  for (const roles of [[], [{ name: "OB戦2026", permissions_suppressed: true }], [{ can_manage_system: true, permissions_suppressed: true }]]) {
    mocks.roles.mockResolvedValueOnce(new Map([["u", roles]]));
    expect((await saveObEventOperation(input)).ok).toBe(false);
  }
  mocks.preview.mockResolvedValueOnce(true);
  expect((await saveObEventOperation(input)).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.roles.mockResolvedValueOnce(new Map([["u", staff]]));
  expect((await saveObEventOperation(input)).ok).toBe(true);
  expect((await saveObEventOperation(input)).ok).toBe(true);
});
it("lets an approved active member record without a helper assignment, retaining staff-only actions", async () => {
  mocks.roles.mockResolvedValue(new Map([["u", []]]));
  mocks.profile.mockResolvedValue({data:{id:"u",approved:true,status:"active"},error:null});
  expect((await saveObEventOperation(input)).ok).toBe(true);
  expect((await setObAttendance({entryId,revision:3,absent:true})).ok).toBe(false);
  expect((await addObDayEntry(dayInput)).ok).toBe(false);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  for (const data of [{id:"u",approved:false,status:"active"},{id:"u",approved:true,status:"graduated"},{id:"other",approved:true,status:"active"}]) {
    mocks.profile.mockResolvedValueOnce({data,error:null});
    expect((await saveObEventOperation(input)).ok).toBe(false);
  }
  mocks.profile.mockResolvedValueOnce({data:{id:"u",approved:true,status:"active"},error:{message:"unavailable"}});
  expect((await saveObEventOperation(input)).ok).toBe(false);
});
it("passes base data for merging and returns the actual server-merged operation", async () => {
  const merged = stored({ confirmed: false, participants: [emptyPerformance(entryId)] });
  mocks.rpc.mockResolvedValueOnce({ data: merged, error: null });
  const result = await saveObEventOperation({ ...input, baseData: input.data });
  expect(result).toEqual({ ok: true, saved: merged });
  expect(mocks.rpc).toHaveBeenCalledWith("save_ob_event_operation_checked", {
    p_event: input.event, p_revision: null, p_data: input.data, p_base_data: input.data,
  });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});
it("returns verified latest data for a conflicting edit without treating it as saved", async () => {
  const latest = { ...stored(), revision: 4 };
  mocks.rpc.mockResolvedValueOnce({ error: { code: "P0001", message: "operation_conflict", details: JSON.stringify(latest) } });
  expect(await saveObEventOperation(input)).toEqual({ ok: false, message: expect.stringContaining("他の端末"), latest });
  mocks.rpc.mockResolvedValueOnce({ error: { code: "P0001", message: "operation_conflict", details: '{"event_name":"other"}' } });
  expect((await saveObEventOperation(input)).latest).toBeUndefined();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("rejects malformed payloads and incomplete/unrelated success responses", async () => {
  for (const malformed of [null, { ...input, event: "other" }, { ...input, revision: -1 }, { ...input, data: {} },
    { ...input, data: { confirmed: false, participants: [null] } }, { ...input, baseData: {} }]) {
    expect((await saveObEventOperation(malformed as unknown as typeof input)).ok).toBe(false);
  }
  expect(mocks.user).not.toHaveBeenCalled();
  for (const data of [null, { ...stored(), event_name: "女子100m" }, { ...stored(), revision: -1 }, { ...stored(), data: {} }]) {
    mocks.rpc.mockResolvedValueOnce({ data, error: null });
    expect((await saveObEventOperation(input)).ok).toBe(false);
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("requires the OB staff role for attendance and day registration even with system permission", async () => {
  expect((await setObAttendance({ entryId, revision: 3, absent: true })).ok).toBe(false);
  expect((await addObDayEntry(dayInput)).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("changes attendance with an expected revision and verifies the returned entry", async () => {
  mocks.roles.mockResolvedValue(new Map([["u", staff]]));
  const saved = { entryId, revision: 4, absent: true };
  mocks.rpc.mockResolvedValueOnce({ data: saved, error: null });
  expect(await setObAttendance({ entryId, revision: 3, absent: true })).toEqual({ ok: true, ...saved });
  expect(mocks.rpc).toHaveBeenCalledWith("set_ob_attendance", { p_entry_id: entryId, p_revision: 3, p_absent: true });
  mocks.rpc.mockResolvedValueOnce({ data: { ...saved, entryId: operationId }, error: null });
  expect((await setObAttendance({ entryId, revision: 3, absent: true })).ok).toBe(false);
  mocks.rpc.mockResolvedValueOnce({ error: { message: "entry_conflict" } });
  expect((await setObAttendance({ entryId, revision: 3, absent: true })).message).toContain("他の端末");
});
it("registers and places through a single idempotent RPC", async () => {
  mocks.roles.mockResolvedValue(new Map([["u", staff]]));
  const saved = stored({ confirmed: false, participants: [{ ...emptyPerformance(entryId), group: 1, order: 1 }] });
  mocks.rpc.mockResolvedValueOnce({ data: { entryId, saved }, error: null });
  expect(await addObDayEntry(dayInput)).toEqual({ ok: true, entryId, saved });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("add_ob_day_entry", {
    p_request_id: operationId, p_event: input.event, p_entry_id: entryId, p_revision: 3, p_name: null, p_grade: null, p_group: 1,
  });
});
it("accepts a new guest without a group and keeps retry identity unchanged", async () => {
  mocks.roles.mockResolvedValue(new Map([["u", staff]]));
  mocks.rpc.mockResolvedValue({ data: { entryId, saved: stored() }, error: null });
  const guest = { operationId, event: input.event, name: "  当日参加  ", grade: "OB・OG" };
  expect((await addObDayEntry(guest)).ok).toBe(true);
  expect((await addObDayEntry(guest)).ok).toBe(true);
  expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_request_id: operationId, p_name: "当日参加", p_grade: "OB・OG", p_group: null });
});
it("marks only an explicit rejected entry revision as safe to refresh and retry anew", async () => {
  mocks.roles.mockResolvedValue(new Map([["u", staff]]));
  mocks.rpc.mockResolvedValueOnce({ error: { message: "entry_conflict" } });
  expect((await addObDayEntry(dayInput)).stale).toBe(true);
  for (const message of ["fetch failed", "operation_request", "operation_conflict", "upstream entry_conflict response unknown"]) {
    mocks.rpc.mockResolvedValueOnce({ error: { message } });
    expect((await addObDayEntry(dayInput)).stale).toBeUndefined();
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("rejects invalid day entries before authentication and shows actionable failures", async () => {
  for (const bad of [{ ...dayInput, operationId: "bad" }, { ...dayInput, revision: undefined }, { ...dayInput, group: 0 },
    { ...dayInput, name: "混在" }, { operationId, event: input.event, name: "新規", grade: "invalid" }]) {
    expect((await addObDayEntry(bad)).ok).toBe(false);
  }
  expect(mocks.user).not.toHaveBeenCalled();
  mocks.roles.mockResolvedValue(new Map([["u", staff]]));
  for (const [error, text] of [["operation_started", "記録の入力"], ["entry_absent", "欠席を取り消し"], ["operation_confirmed", "確定を解除"], ["entry_duplicate", "登録済み"]]) {
    mocks.rpc.mockResolvedValueOnce({ error: { message: error } });
    expect((await addObDayEntry(dayInput)).message).toContain(text);
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
});

const beforeData: MeetEventData = { confirmed: false, participants: [{ ...emptyPerformance(entryId), group: 1, order: 1 }] };
const desiredData: MeetEventData = { ...beforeData, participants: [{ ...beforeData.participants[0], trials: [{ mark: "12.34", status: "valid", wind: "+0.5" }] }] };
const attempt = { event: input.event, revision: 2, data: desiredData, baseData: beforeData };

it("checks an uncertain operation using only a verified event read and keeps disjoint changes", async () => {
  const latest = { ...stored(desiredData), revision: 5, data: { ...desiredData, participants: [
    { ...desiredData.participants[0], group: 2 }, emptyPerformance(operationId),
  ] } };
  mocks.read.mockResolvedValueOnce({ data: latest, error: null });
  expect(await checkObEventOperation(attempt)).toEqual({ ok: true, saved: latest });
  expect(mocks.reads).toEqual([{ table: "ob_event_operations", select: "meet_key,event_name,revision,data,updated_at", filters: [["meet_key", "ob-2026"], ["event_name", input.event]] }]);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("rejects a missing, malformed, older or differently saved result without attempting a write", async () => {
  for (const data of [null, { ...stored(desiredData), revision: 2 }, { ...stored(desiredData), revision: 3, event_name: "女子100m" },
    { ...stored(beforeData), revision: 3 }, { ...stored(desiredData), revision: 3, data: {} }]) {
    mocks.read.mockResolvedValueOnce({ data, error: null });
    expect((await checkObEventOperation(attempt)).ok).toBe(false);
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("holds confirmation after read errors or exceptions without reporting an empty result as saved", async () => {
  mocks.read.mockResolvedValueOnce({ data: null, error: { message: "read failed" } });
  expect((await checkObEventOperation(attempt)).message).toContain("取得できません");
  mocks.read.mockRejectedValueOnce(new Error("read failed"));
  expect((await checkObEventOperation(attempt)).message).toContain("取得できません");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("validates confirmation input before auth and prevents anonymous or preview reads", async () => {
  for (const bad of [{ ...attempt, event: "other" }, { ...attempt, revision: -1 }, { ...attempt, baseData: undefined }, { ...attempt, data: {} }]) {
    expect((await checkObEventOperation(bad as typeof attempt)).ok).toBe(false);
  }
  expect(mocks.user).not.toHaveBeenCalled();
  mocks.user.mockResolvedValueOnce({ data: { user: null } });
  expect((await checkObEventOperation(attempt)).ok).toBe(false);
  mocks.preview.mockResolvedValueOnce(true);
  expect((await checkObEventOperation(attempt)).ok).toBe(false);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("confirms for an approved active member using the verified profile id, not a helper assignment", async () => {
  mocks.roles.mockResolvedValue(new Map([["u", []]]));
  mocks.profile.mockResolvedValueOnce({ data: { id: "u", approved: true, status: "active" }, error: null });
  mocks.read.mockResolvedValueOnce({ data: { ...stored(desiredData), revision: 3 }, error: null });
  expect((await checkObEventOperation(attempt)).ok).toBe(true);
  expect(mocks.reads[0]).toMatchObject({ table: "profiles", filters: [["id", "u"]] });
  mocks.profile.mockResolvedValueOnce({ data: { id: "other", approved: true, status: "active" }, error: null });
  expect((await checkObEventOperation(attempt)).ok).toBe(false);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("distinguishes SQL rollback from unknown transport and malformed success responses", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "operation_position" } });
  expect((await saveObEventOperation(attempt)).uncertain).toBeUndefined();
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied" } });
  expect((await saveObEventOperation(attempt)).uncertain).toBeUndefined();
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "", message: "fetch failed" } });
  expect((await saveObEventOperation(attempt)).uncertain).toBe(true);
  mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
  expect((await saveObEventOperation(attempt)).uncertain).toBe(true);
  mocks.rpc.mockResolvedValueOnce({ data: { ...stored(beforeData), revision: 3 }, error: null });
  expect((await saveObEventOperation(attempt)).uncertain).toBe(true);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

import { scheduleObResultsPublish } from "@/lib/ob-results-notify";
it("notifies only after a verified save, never a rejected or uncertain save",async()=>{
 expect((await saveObEventOperation(input)).ok).toBe(true);
 expect(scheduleObResultsPublish).toHaveBeenCalledTimes(1);
 mocks.rpc.mockResolvedValueOnce({data:null,error:{message:"transport",code:""}});
 expect((await saveObEventOperation(input)).ok).toBe(false);
 expect(scheduleObResultsPublish).toHaveBeenCalledTimes(1);
 mocks.rpc.mockResolvedValueOnce({data:null,error:null});
 expect((await saveObEventOperation(input)).uncertain).toBe(true);
 expect(scheduleObResultsPublish).toHaveBeenCalledTimes(1);
});
