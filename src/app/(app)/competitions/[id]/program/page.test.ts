import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

type TestRole = { name: string; can_manage_system: boolean; can_manage_members: boolean; permissions_suppressed?: boolean };
const mock = vi.hoisted(() => ({
  roles: [] as TestRole[], preview: false, approved: true, status: "active",
  mine: vi.fn(), program: vi.fn(), roster: vi.fn(), operations: vi.fn(), competitionProgram: vi.fn(),
}));
vi.mock("@/lib/supabase/auth", () => ({
  getCurrentProfile: async () => ({ id: "me", display_name: "自分", grade: "B1", roles: mock.roles, approved: mock.approved, status: mock.status }),
  isMemberPreviewActive: async () => mock.preview,
}));
vi.mock("@/lib/queries", () => ({
  getCompetitionById: async (id: string) => ({ id, name: "大会", starts_on: "2026-11-01" }),
  getCompetitionProgramEntries: mock.competitionProgram,
}));
vi.mock("@/lib/queries/ob-entries", () => ({ getMyObEntryFull: mock.mine, getObProgram: mock.program, getObEntries: mock.roster }));
vi.mock("@/lib/queries/ob-operations", () => ({ getObEventOperations: mock.operations }));
vi.mock("@/components/features/ObMeetWorkspace", () => ({ ObMeetWorkspace: "workspace" }));
vi.mock("@/components/features/ObPublicProgram", () => ({ ObPublicProgram: "program" }));
vi.mock("@/components/features/ObEntryHistory", () => ({ ObEntryHistory: "history" }));
vi.mock("@/components/features/ObMyEntry", () => ({ ObMyEntry: "mine" }));
vi.mock("@/components/features/ObDayWorkspace", () => ({ ObDayWorkspace: "day" }));
vi.mock("@/components/features/ObMeetParticipants", () => ({ ObMeetParticipants: "participants" }));
vi.mock("@/components/features/CompetitionProgramView", () => ({ CompetitionProgramView: "other" }));
vi.mock("@/components/layout/SubHeader", () => ({ SubHeader: "header" }));
import Page from "./page";
import { OB_MEET } from "@/lib/ob-meet";

function find(node: ReactNode, type: string): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(value => find(value, type)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (node.type === type) return node.props;
  return find(node.props.children as ReactNode, type);
}
async function workspace(searchParams: { edit?: string; view?: string; section?: string } = {}) {
  return find(await Page({ params: Promise.resolve({ id: OB_MEET.competitionId }), searchParams: Promise.resolve(searchParams) }), "workspace")!;
}
const staff: TestRole = { name: "OB戦2026", can_manage_system: false, can_manage_members: false };

beforeEach(() => {
  vi.clearAllMocks();
  mock.roles = []; mock.preview = false; mock.approved = true; mock.status = "active";
  mock.mine.mockResolvedValue({ entry: null, party: null });
  mock.program.mockResolvedValue({ entries: [], members: [], duties: [], roles: [], operations: [] });
  mock.roster.mockResolvedValue(Object.fromEntries(["entries", "members", "history", "party", "duties", "dutyRoles"].map(key => [key, { data: [] }])));
  mock.operations.mockResolvedValue([]);
  mock.competitionProgram.mockResolvedValue([]);
});

it("lets an approved active member open recording without a helper assignment", async () => {
  const result = await workspace();
  expect(result).toMatchObject({ view: "operations", section: "events", canOperate: true, staff: false });
  expect(find(result.children as ReactNode, "day")).toMatchObject({ canRegister: false, canEditGroups: false });
  expect(find(result.children as ReactNode, "participants")).toBeUndefined();
  expect(mock.mine).not.toHaveBeenCalled();
  expect(mock.roster).not.toHaveBeenCalled();
  expect(mock.operations).not.toHaveBeenCalled();
  expect(mock.program).toHaveBeenCalledTimes(1);
});

it.each([
  { label: "ordinary member without assignments", roles: [] as TestRole[], preview: false, canOperate: true },
  { label: "staff with several roles", roles: [{ name: "全員", can_manage_system: false, can_manage_members: false }, staff], preview: false, canOperate: true },
  { label: "system operator without OB staff", roles: [{ name: "system", can_manage_system: true, can_manage_members: false }], preview: false, canOperate: true },
  { label: "member preview with suppressed staff/system roles", roles: [{ ...staff, permissions_suppressed: true }, { name: "system", can_manage_system: true, can_manage_members: false, permissions_suppressed: true }], preview: true, canOperate: false },
])("shows the complete read-only program for $label without loading participant management", async ({ roles, preview, canOperate }) => {
  mock.roles = roles; mock.preview = preview;
  const program = {
    entries: [
      { id: "male-entry", meet_key: "ob-2026", submitted_name: "合成男子", grade: "B1", profile_id: null, events: ["男子100m"], qualification_marks: {}, revision: 1, imported_at: "" },
      { id: "female-entry", meet_key: "ob-2026", submitted_name: "合成女子", grade: "OB・OG", profile_id: null, events: ["女子100m"], qualification_marks: {}, revision: 1, imported_at: "" },
    ],
    members: [], duties: [], roles: [],
    operations: ["男子100m", "女子100m"].map((event_name, index) => ({ meet_key: "ob-2026", event_name, revision: 2, updated_at: "2026-10-07T00:00:00Z", data: { confirmed: false, participants: [{ entryId: index ? "female-entry" : "male-entry", group: 1, order: index + 1, heatScope: "混合", status: "entered", trials: [] }] } })),
  };
  mock.program.mockResolvedValue(program);
  const result = await workspace({ section: "program" });
  expect(result).toMatchObject({ section: "program", canOperate, staff: roles.some(role => role.name === staff.name && !role.permissions_suppressed) });
  expect(find(result.children as ReactNode, "program")).toMatchObject(program);
  expect(find(result.children as ReactNode, "program")?.canEditDuties ?? false).toBe(false);
  expect(find(result.children as ReactNode, "mine")).toBeUndefined();
  expect(find(result.children as ReactNode, "day")).toBeUndefined();
  expect(find(result.children as ReactNode, "participants")).toBeUndefined();
  expect(find(result.children as ReactNode, "history")).toBeUndefined();
  expect(mock.program).toHaveBeenCalledTimes(1);
  expect(mock.mine).not.toHaveBeenCalled(); expect(mock.roster).not.toHaveBeenCalled(); expect(mock.operations).not.toHaveBeenCalled();
});

it("lets a member without a registration or helper assignment read all duties without gaining duty editing", async () => {
  const duties = [{ meet_key: "ob-2026", profile_id: "other-helper", slot_time: "11:00", event_name: "砲丸投げ", assignment: "計測", revision: 1, role_ids: [] }];
  mock.program.mockResolvedValue({ entries: [], members: [], duties, roles: [], operations: [] });
  const result = await workspace({ section: "duties" });
  expect(result).toMatchObject({ section: "duties", staff: false });
  expect(find(result.children as ReactNode, "program")).toMatchObject({ view: "duties", duties, canEditDuties: false });
  expect(find(result.children as ReactNode, "day")).toBeUndefined(); expect(find(result.children as ReactNode, "participants")).toBeUndefined();
  expect(mock.program).toHaveBeenCalledTimes(1); expect(mock.mine).not.toHaveBeenCalled(); expect(mock.roster).not.toHaveBeenCalled();
});

it("keeps preview read-only on both shared views while preserving the own-registration route", async () => {
  mock.preview = true;
  mock.roles = [{ ...staff, permissions_suppressed: true }, { name: "system", can_manage_system: true, can_manage_members: false, permissions_suppressed: true }];
  for (const section of ["program", "duties"]) {
    const result = await workspace({ view: "operations", section });
    expect(result).toMatchObject({ view: "participant", section, canOperate: false, staff: false });
    expect(find(result.children as ReactNode, "program")).toBeDefined();
    expect(find(result.children as ReactNode, "program")?.canEditDuties ?? false).toBe(false);
    expect(find(result.children as ReactNode, "mine")).toBeUndefined(); expect(find(result.children as ReactNode, "day")).toBeUndefined();
    expect(find(result.children as ReactNode, "participants")).toBeUndefined();
  }
  expect(mock.mine).not.toHaveBeenCalled(); expect(mock.roster).not.toHaveBeenCalled();
  const own = await workspace({ edit: "mine", section: "program" });
  expect(own).toMatchObject({ section: "mine", canOperate: false });
  expect(find(own.children as ReactNode, "mine")).toMatchObject({ openEditor: true, me: { id: "me" } });
  expect(mock.mine).toHaveBeenCalledWith("me");
});

it("keeps mixed-role staff editing independent of the read-only program destination", async () => {
  mock.roles = [{ name: "全員", can_manage_system: false, can_manage_members: false }, staff];
  const readOnly = await workspace({ section: "program" });
  expect(find(readOnly.children as ReactNode, "program")).toBeDefined();
  expect(find(readOnly.children as ReactNode, "program")?.canEditDuties ?? false).toBe(false);
  const duties = await workspace({ section: "duties" });
  expect(find(duties.children as ReactNode, "program")).toMatchObject({ canEditDuties: true });
  const events = await workspace({ section: "events" });
  expect(find(events.children as ReactNode, "day")).toMatchObject({ canRegister: true, canEditGroups: true });
});

it("opens the member's own registration from its section and legacy links without loading management data", async () => {
  const entry = { id: "own-entry", profile_id: "me", submitted_name: "自分の登録" };
  const party = { id: "own-party", submitted_name: "自分の登録", status: "参加" };
  mock.mine.mockResolvedValue({ entry, party });
  const links = [
    { section: "mine" },
    { view: "participant" },
    { view: "program" },
    { view: "mine" },
    { edit: "mine", view: "operations", section: "participants" },
    { edit: "mine", view: "operations", section: "mine" },
  ];
  for (const roles of [[], [staff]]) {
    mock.roles = roles;
    for (const requested of links) {
      const result = await workspace(requested);
      expect(result).toMatchObject({ view: "operations", section: "mine", canOperate: true, staff: roles.length > 0 });
      expect(find(result.children as ReactNode, "mine")).toMatchObject({
        embedded: true, entry, party, me: { id: "me", display_name: "自分", grade: "B1" },
        openEditor: requested.edit === "mine",
      });
      expect(find(result.children as ReactNode, "program")).toBeDefined();
      expect(find(result.children as ReactNode, "day")).toBeUndefined();
      expect(find(result.children as ReactNode, "participants")).toBeUndefined();
    }
  }
  expect(mock.mine).toHaveBeenCalledTimes(links.length * 2);
  expect(mock.mine).toHaveBeenCalledWith("me");
  expect(mock.roster).not.toHaveBeenCalled();
  expect(mock.operations).not.toHaveBeenCalled();
});

it.each(["duties", "heats", "day"])("preserves the old %s link inside operations", async (view) => {
  mock.roles = [staff];
  const result = await workspace({ view });
  expect(result.view).toBe("operations");
  expect(result.section).toBe(view === "duties" ? "duties" : "events");
  if (view === "duties") expect(find(result.children as ReactNode, "program")).toMatchObject({ view: "duties", canEditDuties: true });
  else expect(find(result.children as ReactNode, "day")).toMatchObject({ canRegister: true, canEditGroups: true });
  expect(mock.mine).not.toHaveBeenCalled();
  expect(mock.roster).not.toHaveBeenCalled();
  expect(mock.operations).not.toHaveBeenCalled();
  expect(mock.program).toHaveBeenCalledTimes(1);
});

it.each([{ view: "management" }, { view: "operations", section: "participants" }, { edit: "identity" }])("loads registration management only for its staff destination %j", async (requested) => {
  mock.roles = [staff];
  const result = await workspace(requested);
  expect(result).toMatchObject({ view: "operations", section: "participants", staff: true });
  const participants = find(result.children as ReactNode, "participants")!;
  expect(participants).toMatchObject({ initialFilter: requested.edit === "identity" ? "identity" : "all" });
  expect(isValidElement(participants.footer) && participants.footer.type).toBe("history");
  expect(mock.mine).not.toHaveBeenCalled();
  expect(mock.program).not.toHaveBeenCalled();
  expect(mock.roster).toHaveBeenCalledTimes(1);
  expect(mock.operations).toHaveBeenCalledTimes(1);
});

it("includes history for an OB staff member without another management role", async () => {
  mock.roles = [staff];
  const result = await workspace({ view: "operations", section: "participants" });
  const participants = find(result.children as ReactNode, "participants")!;
  expect(isValidElement(participants.footer) && participants.footer.type).toBe("history");
});

it.each([{ view: "management" }, { view: "operations", section: "participants" }, { edit: "identity" }])("does not grant ordinary members management through %j", async (requested) => {
  const result = await workspace(requested);
  expect(result).toMatchObject({ view: "operations", section: "events", canOperate: true, staff: false });
  expect(find(result.children as ReactNode, "day")).toMatchObject({ canRegister: false, canEditGroups: false });
  expect(find(result.children as ReactNode, "participants")).toBeUndefined();
  expect(mock.mine).not.toHaveBeenCalled();
  expect(mock.roster).not.toHaveBeenCalled();
  expect(mock.operations).not.toHaveBeenCalled();
  expect(mock.program).toHaveBeenCalledTimes(1);
});

it("keeps system recording separate from helper or participant management", async () => {
  mock.roles = [{ name: "system", can_manage_system: true, can_manage_members: false }];
  const result = await workspace({ view: "operations", section: "duties" });
  expect(result).toMatchObject({ canOperate: true, staff: false });
  expect(find(result.children as ReactNode, "program")?.canEditDuties).toBe(false);
  expect(mock.roster).not.toHaveBeenCalled();
  const events = await workspace({ view: "operations" });
  expect(find(events.children as ReactNode, "day")).toMatchObject({ canRegister: false, canEditGroups: true });
});

it("prevents member preview from entering operations even if the account is approved", async () => {
  mock.preview = true;
  mock.roles = [{ ...staff, permissions_suppressed: true }, { name: "system", can_manage_system: true, can_manage_members: false, permissions_suppressed: true }];
  const result = await workspace({ view: "operations", section: "participants" });
  expect(result).toMatchObject({ view: "participant", section: "program", canOperate: false, staff: false });
  expect(find(result.children as ReactNode, "program")).toBeDefined();
  expect(find(result.children as ReactNode, "program")?.canEditDuties ?? false).toBe(false);
  expect(find(result.children as ReactNode, "mine")).toBeUndefined();
  expect(find(result.children as ReactNode, "day")).toBeUndefined();
  expect(find(result.children as ReactNode, "participants")).toBeUndefined();
  expect(mock.mine).not.toHaveBeenCalled();
  expect(mock.roster).not.toHaveBeenCalled();
  expect(mock.operations).not.toHaveBeenCalled();
});

it.each([{ approved: false, status: "active" }, { approved: true, status: "archived" }])("keeps unapproved or graduated ordinary accounts out of recording and management %j", async (profile) => {
  mock.approved = profile.approved; mock.status = profile.status;
  const result = await workspace({ view: "operations", section: "participants" });
  expect(result).toMatchObject({ view: "participant", section: "program", canOperate: false, staff: false });
  expect(find(result.children as ReactNode, "program")).toBeDefined();
  expect(find(result.children as ReactNode, "program")?.canEditDuties ?? false).toBe(false);
  expect(find(result.children as ReactNode, "mine")).toBeUndefined();
  expect(find(result.children as ReactNode, "day")).toBeUndefined();
  expect(find(result.children as ReactNode, "participants")).toBeUndefined();
  expect(mock.mine).not.toHaveBeenCalled();
  expect(mock.roster).not.toHaveBeenCalled();
  expect(mock.operations).not.toHaveBeenCalled();
});

it("retains the ordinary competition program and its system edit permission", async () => {
  for (const roles of [[], [{ name: "system", can_manage_system: true, can_manage_members: false }]]) {
    mock.roles = roles;
    const result = await Page({ params: Promise.resolve({ id: "other-meet" }), searchParams: Promise.resolve({ view: "operations" }) });
    expect(find(result, "other")).toMatchObject({ canManage: roles.length > 0, initialEntries: [] });
    expect(find(result, "workspace")).toBeUndefined();
  }
  expect(mock.competitionProgram).toHaveBeenCalledWith("other-meet");
  expect(mock.competitionProgram).toHaveBeenCalledTimes(2);
  expect(mock.program).not.toHaveBeenCalled();
  expect(mock.mine).not.toHaveBeenCalled();
  expect(mock.roster).not.toHaveBeenCalled();
  expect(mock.operations).not.toHaveBeenCalled();
});

it("reports program load failure instead of rendering an empty meet", async () => {
  mock.program.mockRejectedValue(new Error("プログラムを取得できませんでした"));
  await expect(workspace({ view: "participant" })).rejects.toThrow("プログラムを取得できませんでした");
});

it.each(["program", "duties"])("preserves a %s load failure instead of claiming no participants or assignments", async section => {
  mock.program.mockRejectedValue(new Error("プログラムを取得できませんでした"));
  await expect(workspace({ section })).rejects.toThrow("プログラムを取得できませんでした");
  expect(mock.mine).not.toHaveBeenCalled(); expect(mock.roster).not.toHaveBeenCalled();
});
