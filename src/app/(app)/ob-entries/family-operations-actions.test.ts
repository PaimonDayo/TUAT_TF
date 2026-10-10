vi.mock("@/lib/ob-results-notify", () => ({ scheduleObResultsPublish: vi.fn() }));
import { beforeEach, expect, it, vi } from "vitest";
import { emptyPerformance, type MeetEventData } from "@/lib/meet-operations";
import type { ObMixedInput } from "@/lib/ob-mixed-operations";
import type { ObEventOperation } from "@/lib/ob-operations";
import { OB_PROGRAM_PATH } from "@/lib/ob-meet";

const mocks = vi.hoisted(() => ({ user: vi.fn(), roles: vi.fn(), preview: vi.fn(), rpc: vi.fn(), refresh: vi.fn(), read: vi.fn(), reads: [] as { table: string; select: string; filters: [string, string][]; in?: [string, string[]] }[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, rpc: mocks.rpc, from: (table: string) => {
  const read = { table, select: "", filters: [] as [string, string][], in: undefined as [string, string[]] | undefined };
  const query = {
    select(columns: string) { read.select = columns; return query; },
    eq(column: string, value: string) { read.filters.push([column, value]); return query; },
    in(column: string, values: string[]) { read.in = [column, values]; mocks.reads.push(read); return mocks.read(); },
    maybeSingle() { mocks.reads.push(read); return mocks.read(); },
  };
  return query;
} }) }));
vi.mock("@/lib/supabase/auth", () => ({ fetchRolesByProfileIds: mocks.roles, isMemberPreviewActive: mocks.preview }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { checkObFamilyOperation, saveObFamilyOperation } from "./operations-actions";

const male = "男子100m", female = "女子100m";
const a = "10000000-0000-4000-8000-000000000001", b = "10000000-0000-4000-8000-000000000002";
const base = (id: string): MeetEventData => ({ confirmed: false, participants: [{ ...emptyPerformance(id), group: 1, order: 1 }] });
const request = (event: string, id: string, revision: number): ObMixedInput => ({ event, revision, baseData: base(id), data: { confirmed: false, participants: [{ ...base(id).participants[0], heatScope: "混合", order: event === male ? 1 : 2 }] } });
const input = () => ({ family: "100m", operations: [request(male, a, 3), request(female, b, 5)] });
const stored = (request: ObMixedInput, revision = (request.revision ?? -1) + 1, data = request.data): ObEventOperation => ({ meet_key: "ob-2026", event_name: request.event, revision, data, updated_at: "2026-10-07T00:00:00Z" });
const rows = (attempt = input()) => attempt.operations.map(request => stored(request));
const oneChanged = () => {
  const attempt = input(); attempt.operations[1].data = attempt.operations[1].baseData;
  return attempt;
};
beforeEach(() => {
  vi.clearAllMocks(); mocks.reads = [];
  mocks.user.mockResolvedValue({ data: { user: { id: "operator" } } });
  mocks.preview.mockResolvedValue(false);
  mocks.roles.mockResolvedValue(new Map([["operator", [{ name: "OB戦2026", can_manage_system: false }]]]));
  mocks.rpc.mockResolvedValue({ data: { operations: rows() }, error: null });
  mocks.read.mockResolvedValue({ data: rows(), error: null });
});

it("sends both original source snapshots through one atomic RPC and returns both verified saved operations", async () => {
  const attempt = input(); const saved = rows(attempt);
  mocks.rpc.mockResolvedValueOnce({ data: { operations: saved }, error: null });
  expect(await saveObFamilyOperation(attempt)).toEqual({ ok: true, saved });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith("save_ob_family_operation_checked", { p_family: "100m", p_operations: attempt.operations });
  expect(mocks.refresh).toHaveBeenCalledWith(OB_PROGRAM_PATH); expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.roles).toHaveBeenCalledWith(expect.anything(), ["operator"]);
});

it("confirms both frozen source changes with one authorized read and no write or revalidation", async () => {
  expect(await checkObFamilyOperation(input())).toEqual({ ok: true, saved: rows() });
  expect(mocks.reads).toEqual([{ table: "ob_event_operations", select: "meet_key,event_name,revision,data,updated_at", filters: [["meet_key", "ob-2026"]], in: ["event_name", [male, female]] }]);
  expect(mocks.read).toHaveBeenCalledTimes(1); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
});

it("requires the unsuppressed OB staff role even for an approved member or system operator", async () => {
  for (const roles of [[], [{ name: "system", can_manage_system: true }], [{ name: "OB戦2026", can_manage_system: false, permissions_suppressed: true }], [{ name: "OB戦2026", can_manage_system: true, permissions_suppressed: true }]]) {
    mocks.roles.mockResolvedValue(new Map([["operator", roles]]));
    expect((await saveObFamilyOperation(input())).ok).toBe(false);
    expect((await checkObFamilyOperation(input())).ok).toBe(false);
  }
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});

it("rejects anonymous, preview, and role maps belonging to a different verified user", async () => {
  mocks.user.mockResolvedValueOnce({ data: { user: null } });
  expect((await saveObFamilyOperation(input())).ok).toBe(false);
  mocks.preview.mockResolvedValueOnce(true);
  expect((await checkObFamilyOperation(input())).ok).toBe(false);
  mocks.user.mockResolvedValueOnce({ data: { user: { id: "other" } } });
  expect((await saveObFamilyOperation(input())).ok).toBe(false);
  expect(mocks.roles).toHaveBeenLastCalledWith(expect.anything(), ["other"]);
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});

it("rejects malformed family/source data before authentication or database work", async () => {
  const malformed: unknown[] = [null, { ...input(), family: "other" }, { ...input(), operations: [] }, { ...input(), operations: [input().operations[0]] },
    { ...input(), operations: [input().operations[0], input().operations[0]] }, { ...input(), operations: [input().operations[0], { ...input().operations[1], event: "女子300m" }] },
    { ...input(), operations: [{ ...input().operations[0], revision: -1 }, input().operations[1]] }, { ...input(), operations: [{ ...input().operations[0], revision: 1.5 }, input().operations[1]] },
    { ...input(), operations: [{ ...input().operations[0], baseData: {} }, input().operations[1]] }, { ...input(), operations: [{ ...input().operations[0], data: { confirmed: false, participants: [null] } }, input().operations[1]] },
    { ...input(), operations: [{ ...input().operations[0], data: { confirmed: false, participants: [{ ...emptyPerformance(a), heatScope: "other" }] } }, input().operations[1]] },
  ];
  for (const value of malformed) {
    expect((await saveObFamilyOperation(value as Parameters<typeof saveObFamilyOperation>[0])).ok).toBe(false);
    expect((await checkObFamilyOperation(value as Parameters<typeof checkObFamilyOperation>[0])).ok).toBe(false);
  }
  expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});

it("does not call the RPC for unchanged snapshots or explicit source-division metadata normalization", async () => {
  const attempt = input();
  for (const request of attempt.operations) request.data = { ...request.baseData, participants: request.baseData.participants.map(person => ({ ...person, heatScope: request.event === male ? "男子" : "女子" })) };
  expect(await saveObFamilyOperation(attempt)).toEqual({ ok: false, message: "変更はありません" });
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
});

it("a real scope change is saved even when the source's raw group/order numbers stay the same", async () => {
  const attempt = oneChanged();
  mocks.rpc.mockResolvedValueOnce({ data: { operations: [stored(attempt.operations[0]), stored(attempt.operations[1], 5)] }, error: null });
  expect((await saveObFamilyOperation(attempt)).ok).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});

it("accepts field order 600 but rejects 601 before authorization", async () => {
  const attempt = input(); attempt.family = "砲丸投げ";
  attempt.operations = attempt.operations.map((request, index) => ({ ...request, event: index ? "女子砲丸投げ" : "男子砲丸投げ", data: { ...request.data, participants: request.data.participants.map(person => ({ ...person, order: index ? 599 : 600 })) } }));
  mocks.rpc.mockResolvedValueOnce({ data: { operations: rows(attempt) }, error: null });
  expect((await saveObFamilyOperation(attempt)).ok).toBe(true);
  vi.clearAllMocks(); attempt.operations[0].data.participants[0].order = 601;
  expect((await saveObFamilyOperation(attempt)).ok).toBe(false);
  expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});

it("rejects incomplete, duplicate, unrelated or malformed atomic success evidence as uncertain", async () => {
  const saved = rows();
  const invalid: unknown[] = [null, [], [saved[0]], [saved[0], saved[0]], [saved[0], { ...saved[1], event_name: "女子300m" }],
    [saved[0], { ...saved[1], meet_key: "other" }], [saved[0], { ...saved[1], data: {} }], [saved[0], { ...saved[1], revision: -1 }],
    [saved[0], { ...saved[1], data: input().operations[1].baseData }], [saved[0], { ...saved[1], data: { confirmed: false, participants: [] } }],
  ];
  for (const operations of invalid) {
    mocks.rpc.mockResolvedValueOnce({ data: { operations }, error: null });
    expect(await saveObFamilyOperation(input())).toMatchObject({ ok: false, uncertain: true });
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("does not confirm a partial read even if one submitted source has committed", async () => {
  mocks.read.mockResolvedValueOnce({ data: [rows()[0], { ...rows()[1], data: input().operations[1].baseData }], error: null });
  expect(await checkObFamilyOperation(input())).toMatchObject({ ok: false, message: expect.stringContaining("男女両方") });
  mocks.read.mockResolvedValueOnce({ data: [rows()[0]], error: null });
  expect((await checkObFamilyOperation(input())).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
});

it("rejects an older unchanged sibling in an atomic response and in read-only confirmation", async () => {
  const attempt = oneChanged();
  const saved = [stored(attempt.operations[0]), stored(attempt.operations[1], 4, { ...base(b), participants: [{ ...base(b).participants[0], order: 9 }] })];
  mocks.rpc.mockResolvedValueOnce({ data: { operations: saved }, error: null });
  expect(await saveObFamilyOperation(attempt)).toMatchObject({ ok: false, uncertain: true });
  mocks.read.mockResolvedValueOnce({ data: saved, error: null });
  expect((await checkObFamilyOperation(attempt)).ok).toBe(false);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("requires revision advancement for each changed source while accepting an unchanged sibling at its base revision", async () => {
  const attempt = oneChanged();
  const saved = [stored(attempt.operations[0]), stored(attempt.operations[1], 5)];
  mocks.rpc.mockResolvedValueOnce({ data: { operations: saved }, error: null });
  expect(await saveObFamilyOperation(attempt)).toEqual({ ok: true, saved });
  const unchangedRevision = [stored(attempt.operations[0], 3), saved[1]];
  mocks.rpc.mockResolvedValueOnce({ data: { operations: unchangedRevision }, error: null });
  expect(await saveObFamilyOperation(attempt)).toMatchObject({ ok: false, uncertain: true });
  mocks.read.mockResolvedValueOnce({ data: unchangedRevision, error: null });
  expect((await checkObFamilyOperation(attempt)).ok).toBe(false);
});

it("retains later independent edits and new participants when both submitted changes are proven", async () => {
  const attempt = input();
  const saved = rows(attempt).map(operation => ({ ...operation, revision: operation.revision + 2, data: { ...operation.data, participants: [{ ...operation.data.participants[0], trials: [{ mark: "12.99", status: "valid" as const, wind: "" }] }, emptyPerformance(`new-${operation.event_name}`)] } }));
  mocks.rpc.mockResolvedValueOnce({ data: { operations: saved }, error: null });
  expect(await saveObFamilyOperation(attempt)).toEqual({ ok: true, saved });
  mocks.read.mockResolvedValueOnce({ data: saved, error: null });
  expect(await checkObFamilyOperation(attempt)).toEqual({ ok: true, saved });
});

it("permits an unsaved empty sibling to remain absent from the atomic response", async () => {
  const attempt = input(); attempt.operations[1] = { event: female, revision: null, baseData: { confirmed: false, participants: [] }, data: { confirmed: false, participants: [] } };
  const saved = [stored(attempt.operations[0])];
  mocks.rpc.mockResolvedValueOnce({ data: { operations: saved }, error: null });
  expect(await saveObFamilyOperation(attempt)).toEqual({ ok: true, saved });
  mocks.read.mockResolvedValueOnce({ data: saved, error: null });
  expect(await checkObFamilyOperation(attempt)).toEqual({ ok: true, saved });
});

it("treats a SQL rollback as definitive and a transport error as uncertain", async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { code: "P0001", message: "operation_position" }, data: null });
  const rollback = await saveObFamilyOperation(input());
  expect(rollback).toMatchObject({ ok: false, message: expect.stringContaining("重複") }); expect(rollback.uncertain).toBeUndefined();
  mocks.rpc.mockResolvedValueOnce({ error: { code: "", message: "response lost" }, data: null });
  expect(await saveObFamilyOperation(input())).toMatchObject({ ok: false, uncertain: true });
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
});

it("returns verified current family snapshots for conflict review after a rolled-back write", async () => {
  const latest = rows(); mocks.rpc.mockResolvedValueOnce({ error: { code: "P0001", message: "operation_conflict", details: "untrusted" }, data: null });
  mocks.read.mockResolvedValueOnce({ data: latest, error: null });
  const result = await saveObFamilyOperation(input());
  expect(result).toEqual({ ok: false, message: expect.stringContaining("他の端末"), latest });
  expect(mocks.read).toHaveBeenCalledTimes(1); expect(mocks.refresh).not.toHaveBeenCalled();
});

it("never returns malformed or denied reads as successful confirmation or conflict snapshots", async () => {
  for (const response of [{ data: rows(), error: { message: "permission denied" } }, { data: null, error: null }, { data: [rows()[0], { ...rows()[1], event_name: "女子300m" }], error: null }]) {
    mocks.read.mockResolvedValueOnce(response);
    expect((await checkObFamilyOperation(input())).ok).toBe(false);
  }
  mocks.rpc.mockResolvedValueOnce({ error: { code: "P0001", message: "operation_conflict" }, data: null });
  mocks.read.mockResolvedValueOnce({ data: rows(), error: { message: "permission denied" } });
  expect((await saveObFamilyOperation(input())).latest).toBeUndefined();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("read exceptions preserve a failed confirmation without writing", async () => {
  mocks.read.mockRejectedValueOnce(new Error("unavailable"));
  expect(await checkObFamilyOperation(input())).toMatchObject({ ok: false, message: expect.stringContaining("入力は残っています") });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("keeps a proven conflict rollback definitive even when retrieving the review snapshots throws", async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { code: "P0001", message: "operation_conflict" }, data: null });
  mocks.read.mockRejectedValueOnce(new Error("review read unavailable"));
  const result = await saveObFamilyOperation(input());
  expect(result).toMatchObject({ ok: false, message: expect.stringContaining("他の端末") });
  expect(result.uncertain).toBeUndefined(); expect(result.latest).toBeUndefined();
  expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.refresh).not.toHaveBeenCalled();
});
