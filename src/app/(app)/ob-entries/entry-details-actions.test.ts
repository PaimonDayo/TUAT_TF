vi.mock("@/lib/ob-results-notify", () => ({ scheduleObResultsPublish: vi.fn() }));
import { beforeEach, expect, it, vi } from "vitest";
import type { EntryEdit } from "@/lib/ob-entry-edit";
import { OB_PROGRAM_PATH, type PartyEdit } from "@/lib/ob-meet";

const mocks = vi.hoisted(() => ({ user: vi.fn(), roles: vi.fn(), preview: vi.fn(), rpc: vi.fn(), from: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/supabase/auth", () => ({ fetchRolesByProfileIds: mocks.roles, isMemberPreviewActive: mocks.preview }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { checkEntryDetails, saveEntry } from "./actions";

const id = "10000000-0000-4000-8000-000000000001", partyId = "20000000-0000-4000-8000-000000000001", otherId = "30000000-0000-4000-8000-000000000001";
const input = (): EntryEdit => ({ entryId: id, profileId: null, revision: 3, events: ["男子100m", "男子300m"], marks: { "男子100m": "12秒34", "男子300m": null }, details: { name: " 合成修正名 ", grade: "M2" } });
const party: PartyEdit = { id: partyId, revision: 6, status: "参加" };
const unanswered: PartyEdit = { id: null, revision: null, status: "未回答" };
const snapshot = () => ({ entry: { id, revision: 4, submitted_name: "合成修正名", grade: "M2", events: input().events, qualification_marks: input().marks }, party: { id: partyId, revision: 6, status: "参加", entry_id: id } });
const saved = () => ({ entryId: id, conflicts: [], ...snapshot() });
const checkRefresh = () => {
  expect(mocks.refresh.mock.calls.map(call => call[0])).toEqual(["/ob-entries", OB_PROGRAM_PATH, "/home"]);
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: "operator" } } });
  mocks.roles.mockResolvedValue(new Map([["operator", [{ name: "OB戦2026", can_manage_system: false }]]]));
  mocks.preview.mockResolvedValue(false);
  mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "get_ob_registration_details_snapshot" ? snapshot() : name === "save_ob_registration_checked" ? { entryId: id, conflicts: [] } : saved() }));
});

it("saves corrected details, registration and party through one staff-only RPC using the original revisions", async () => {
  const attempt = input(); const original = structuredClone(attempt);
  expect(await saveEntry(attempt, party, true)).toEqual({ ok: true, dutyConflicts: [] });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith("save_ob_registration_details_checked", { p_entry_id: id, p_profile_id: null, p_revision: 3, p_events: attempt.events, p_marks: attempt.marks, p_party_id: partyId, p_party_revision: 6, p_party_status: "参加", p_confirm_duties: true, p_name: "合成修正名", p_grade: "M2" });
  expect(attempt).toEqual(original); expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.roles).toHaveBeenCalledWith(expect.anything(), ["operator"]);
  checkRefresh();
});

it("confirms the frozen details/registration/party with a read-only snapshot RPC and returns no raw snapshot", async () => {
  const attempt = structuredClone(input()); const original = structuredClone(attempt);
  expect(await checkEntryDetails(attempt, party)).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith("get_ob_registration_details_snapshot", { p_entry_id: id });
  expect(attempt).toEqual(original); expect(mocks.from).not.toHaveBeenCalled();
  checkRefresh();
});

it("retains ordinary member registration edits without granting them name/grade changes", async () => {
  mocks.roles.mockResolvedValue(new Map([["operator", []]]));
  const ordinary = input(); delete ordinary.details;
  expect(await saveEntry(ordinary, party)).toEqual({ ok: true, dutyConflicts: [] });
  expect(mocks.roles).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith("save_ob_registration_checked", expect.objectContaining({ p_entry_id: id, p_revision: 3 }));
  expect((await saveEntry(input(), party)).ok).toBe(false);
  expect((await checkEntryDetails(input(), party)).ok).toBe(false);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});

it("denies anonymous, preview, system-only, suppressed staff and another user's role map before detail data access", async () => {
  mocks.user.mockResolvedValueOnce({ data: { user: null } });
  expect((await saveEntry(input(), party)).ok).toBe(false);
  mocks.preview.mockResolvedValueOnce(true);
  expect((await checkEntryDetails(input(), party)).ok).toBe(false);
  for (const roles of [[], [{ name: "system", can_manage_system: true }], [{ name: "OB戦2026", can_manage_system: false, permissions_suppressed: true }]]) {
    mocks.roles.mockResolvedValue(new Map([["operator", roles]]));
    expect((await saveEntry(input(), party)).ok).toBe(false);
    expect((await checkEntryDetails(input(), party)).ok).toBe(false);
  }
  mocks.roles.mockResolvedValue(new Map([["other", [{ name: "OB戦2026", can_manage_system: false }]]]));
  expect((await saveEntry(input(), party)).ok).toBe(false);
  expect(mocks.roles).toHaveBeenLastCalledWith(expect.anything(), ["operator"]);
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
});

it("rejects malformed details, edit identities, revisions, events, marks and party before authentication", async () => {
  const invalid: unknown[] = [null, { ...input(), details: null }, { ...input(), details: {} }, { ...input(), details: [] },
    { ...input(), details: { name: " ", grade: "B1" } }, { ...input(), details: { name: "x".repeat(101), grade: "B1" } },
    { ...input(), details: { name: "合成", grade: "unknown" } }, { ...input(), details: { name: 1, grade: "B1" } },
    { ...input(), details: { name: "合成", grade: "B1", profileId: otherId } },
    { ...input(), entryId: null, profileId: id, revision: null }, { ...input(), entryId: "bad" }, { ...input(), profileId: otherId },
    { ...input(), revision: -1 }, { ...input(), events: ["男子100m", "女子100m"] }, { ...input(), marks: { other: "12" } },
  ];
  for (const attempt of invalid) {
    expect((await saveEntry(attempt as EntryEdit, party)).ok).toBe(false);
    expect((await checkEntryDetails(attempt as EntryEdit, party)).ok).toBe(false);
  }
  const badParty = { ...party, revision: -1 };
  expect((await saveEntry(input(), badParty)).ok).toBe(false);
  expect((await checkEntryDetails(input(), badParty)).ok).toBe(false);
  expect((await saveEntry(input(), party, "true" as unknown as boolean)).ok).toBe(false);
  expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});

it("does not perform a metadata snapshot read for ordinary edits without frozen details", async () => {
  const attempt = input(); delete attempt.details;
  expect((await checkEntryDetails(attempt, party)).ok).toBe(false);
  expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});

it.each([
  { code: "P0001", message: "entry_conflict", expected: "更新されています" },
  { code: "23505", message: "entry_duplicate", expected: "同じ氏名" },
  { code: "42501", message: "entry_forbidden", expected: "自分のエントリー" },
])("keeps the proven SQL rollback definitive for $message", async ({ code, message, expected }) => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message } });
  const result = await saveEntry(input(), party);
  expect(result).toMatchObject({ ok: false, message: expect.stringContaining(expected) }); expect(result.uncertain).toBeUndefined();
  expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.refresh).not.toHaveBeenCalled();
});

it("returns verified duty conflicts after rollback so the caller may acknowledge and retry explicitly", async () => {
  const conflicts = [{ time: "11:00", event: "砲丸投げ", assignment: "計測" }];
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "entry_duty_conflict", details: JSON.stringify(conflicts) } });
  expect(await saveEntry(input(), party)).toEqual({ ok: false, message: expect.stringContaining("重複"), dutyConflicts: conflicts });
  expect(mocks.refresh).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({ data: { ...saved(), conflicts }, error: null });
  expect(await saveEntry(input(), party, true)).toEqual({ ok: true, dutyConflicts: conflicts });
  expect(mocks.rpc).toHaveBeenLastCalledWith("save_ob_registration_details_checked", expect.objectContaining({ p_confirm_duties: true }));
});

it.each([undefined, "", "ECONNRESET", "500"])("marks a transport response with code %s as uncertain without refreshing or retrying", async code => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: "response lost" } });
  expect(await saveEntry(input(), party)).toMatchObject({ ok: false, uncertain: true });
  expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.refresh).not.toHaveBeenCalled();
});

it("does not report success or issue an automatic retry if the write response throws", async () => {
  mocks.rpc.mockRejectedValueOnce(new Error("response lost"));
  await expect(saveEntry(input(), party)).rejects.toThrow("response lost");
  expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.refresh).not.toHaveBeenCalled();
});

it("requires a newer entry revision in both the write response and the read-only proof", async () => {
  for (const revision of [3, 2, -1, 3.5, "4", null]) {
    const evidence = { ...snapshot(), entry: { ...snapshot().entry, revision } };
    mocks.rpc.mockResolvedValueOnce({ data: { entryId: id, conflicts: [], ...evidence }, error: null });
    expect(await saveEntry(input(), party)).toMatchObject({ ok: false, uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ data: evidence, error: null });
    expect((await checkEntryDetails(input(), party)).ok).toBe(false);
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("rejects wrong names, grades, identity, schema, event sets and qualification marks in both proof paths", async () => {
  const good = snapshot();
  const invalid: unknown[] = [null, [], {}, { ...good, entry: null }, { ...good, entry: { ...good.entry, id: otherId } },
    { ...good, entry: { ...good.entry, submitted_name: "旧氏名" } }, { ...good, entry: { ...good.entry, grade: "B1" } },
    { ...good, entry: { ...good.entry, events: ["男子100m"] } }, { ...good, entry: { ...good.entry, events: ["男子100m", "女子100m"] } },
    { ...good, entry: { ...good.entry, events: ["男子100m", "男子100m"] } }, { ...good, entry: { ...good.entry, events: "男子100m" } },
    { ...good, entry: { ...good.entry, qualification_marks: null } }, { ...good, entry: { ...good.entry, qualification_marks: [] } },
    { ...good, entry: { ...good.entry, qualification_marks: { "男子100m": "12秒34" } } },
    { ...good, entry: { ...good.entry, qualification_marks: { ...good.entry.qualification_marks, "男子300m": "未回答" } } },
    { ...good, entry: { ...good.entry, qualification_marks: { ...good.entry.qualification_marks, other: "extra" } } },
  ];
  for (const evidence of invalid) {
    const response = evidence && typeof evidence === "object" && !Array.isArray(evidence) ? { entryId: id, conflicts: [], ...evidence } : evidence;
    mocks.rpc.mockResolvedValueOnce({ data: response, error: null });
    expect(await saveEntry(input(), party)).toMatchObject({ ok: false, uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ data: evidence, error: null });
    expect((await checkEntryDetails(input(), party)).ok).toBe(false);
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("rejects inconsistent top-level identity and malformed conflict rows without returning success", async () => {
  for (const response of [{ ...saved(), entryId: otherId }, { ...saved(), entryId: "bad" }, { ...saved(), conflicts: null },
    { ...saved(), conflicts: [null] }, { ...saved(), conflicts: ["invalid"] }, { ...saved(), conflicts: [{ time: "11:00", event: "100m", assignment: 1 }] }]) {
    mocks.rpc.mockResolvedValueOnce({ data: response, error: null });
    expect(await saveEntry(input(), party)).toMatchObject({ ok: false, uncertain: true });
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("requires the same party identity, linked entry, submitted status and nonolder revision", async () => {
  const good = snapshot();
  const invalid: unknown[] = [null, {}, [], { ...good.party, id: otherId }, { ...good.party, id: "z".repeat(36) },
    { ...good.party, entry_id: otherId }, { ...good.party, status: "不参加" }, { ...good.party, revision: 5 },
    { ...good.party, revision: -1 }, { ...good.party, revision: 6.5 }, { ...good.party, revision: "7" },
  ];
  for (const value of invalid) {
    const evidence = { ...good, party: value };
    mocks.rpc.mockResolvedValueOnce({ data: { entryId: id, conflicts: [], ...evidence }, error: null });
    expect(await saveEntry(input(), party)).toMatchObject({ ok: false, uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ data: evidence, error: null });
    expect((await checkEntryDetails(input(), party)).ok).toBe(false);
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("accepts an unchanged party revision and order-independent event/qualification-mark JSON", async () => {
  const good = snapshot();
  const evidence = { ...good, entry: { ...good.entry, events: [...good.entry.events].reverse(), qualification_marks: { "男子300m": null, "男子100m": "12秒34" } } };
  mocks.rpc.mockResolvedValueOnce({ data: { entryId: id, conflicts: [], ...evidence }, error: null });
  expect(await saveEntry(input(), party)).toEqual({ ok: true, dutyConflicts: [] });
  mocks.rpc.mockResolvedValueOnce({ data: evidence, error: null });
  expect(await checkEntryDetails(input(), party)).toEqual({ ok: true });
});

it("allows an unregistered unanswered party to remain explicitly null in both proof paths", async () => {
  const evidence = { ...snapshot(), party: null };
  mocks.rpc.mockResolvedValueOnce({ data: { entryId: id, conflicts: [], ...evidence }, error: null });
  expect(await saveEntry(input(), unanswered)).toEqual({ ok: true, dutyConflicts: [] });
  mocks.rpc.mockResolvedValueOnce({ data: evidence, error: null });
  expect(await checkEntryDetails(input(), unanswered)).toEqual({ ok: true });
  expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["save_ob_registration_details_checked", "get_ob_registration_details_snapshot"]);
});

it("does not accept an absent or invalid party property as proof that an unanswered party remains unregistered", async () => {
  for (const value of [undefined, false, 0, "", "null"]) {
    const evidence = { ...snapshot(), party: value };
    if (value === undefined) delete (evidence as { party?: unknown }).party;
    mocks.rpc.mockResolvedValueOnce({ data: { entryId: id, conflicts: [], ...evidence }, error: null });
    expect(await saveEntry(input(), unanswered)).toMatchObject({ ok: false, uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ data: evidence, error: null });
    expect((await checkEntryDetails(input(), unanswered)).ok).toBe(false);
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("a requested party answer cannot be confirmed from null even when entry details are correct", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { ...snapshot(), party: null }, error: null });
  expect((await checkEntryDetails(input(), { id: null, revision: null, status: "参加" })).ok).toBe(false);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("does not require party proof when the attempt never requested a party edit", async () => {
  const evidence = { entry: snapshot().entry, party: null };
  mocks.rpc.mockResolvedValueOnce({ data: { entryId: id, conflicts: [], ...evidence }, error: null });
  expect(await saveEntry(input())).toEqual({ ok: true, dutyConflicts: [] });
  mocks.rpc.mockResolvedValueOnce({ data: evidence, error: null });
  expect(await checkEntryDetails(input())).toEqual({ ok: true });
});

it("failed repeated confirmations leave the frozen attempt intact and never invoke a save RPC", async () => {
  const attempt = structuredClone(input()); const original = structuredClone(attempt);
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied" } });
  expect((await checkEntryDetails(attempt, party)).ok).toBe(false);
  mocks.rpc.mockRejectedValueOnce(new Error("read unavailable"));
  expect(await checkEntryDetails(attempt, party)).toMatchObject({ ok: false, message: expect.stringContaining("入力は残っています") });
  expect(attempt).toEqual(original);
  expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["get_ob_registration_details_snapshot", "get_ob_registration_details_snapshot"]);
  expect(mocks.refresh).not.toHaveBeenCalled();
});
