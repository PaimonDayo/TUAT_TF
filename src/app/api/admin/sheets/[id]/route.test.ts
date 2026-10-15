import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole, RecordFieldDef } from "@/types";
import type { Database } from "@/types/database";
import { buildSheetRecordFields, relevantSheetHeaderSignature } from "@/lib/sheet-field-config";
import { recordFieldsToJson } from "@/lib/profile-normalize";
import { OCTOBER_SHEET_ID } from "@/lib/sheet-period";

const mocks = vi.hoisted(() => ({ client: vi.fn(), roles: vi.fn(), admin: vi.fn(), member: vi.fn(), members: vi.fn(), preview: false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/auth", () => ({ fetchRolesByProfileIds: mocks.roles }));
vi.mock("@/lib/sheet-public-csv", () => ({ fetchPublicMember: mocks.member, fetchPublicSheetMembers: mocks.members }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.preview ? { value: "1" } : undefined }) }));
import { GET, POST } from "./route";

type Target = Pick<Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "blocks" | "sheet_name" | "record_fields" | "record_fields_version" | "sheet_header_signature" | "sheet_transition" | "record_source">;
type Draft = { revision: string; fields: RecordFieldDef[]; isMiddleLong: boolean; header: { signature: string; columns: typeof columns; sheetName: string; memoCandidates: number[] } };
const columns = ["日付", "メニュー", "目的・意識すること", "考えたこと", "コメント", "追加項目"]
  .map((label, index) => ({ index, label }));
const context = () => ({ params: Promise.resolve({ id: "target" }) });
const url = "https://app.example.invalid/api/admin/sheets/target";
const getRequest = (query = "") => new Request(url + query);
const postRequest = (body: unknown, origin = "https://app.example.invalid") => new Request(url, {
  method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

function role(overrides: Partial<AppRole> = {}): AppRole {
  return {
    id: "role", name: "担当", color: "blue", category: null, is_everyone: false,
    is_system: false, sort_order: 0, created_at: "2026-10-15T00:00:00Z",
    can_manage_system: false, can_manage_members: false, can_create_notice: false,
    can_create_menu: false, can_create_schedule: false, can_decide_practice: false, ...overrides,
  };
}

function selectedFields(selectedColumns = [1, 2, 3, 4], timelineColumns = [1, 4]) {
  return buildSheetRecordFields({ columns, selectedColumns, timelineColumns, types: {}, isMiddleLong: false, memoColumn: null });
}

let target: Target;
const user = vi.fn(), read = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
const from = vi.fn();
const rpc = vi.fn();
async function draft(): Promise<Draft> {
  const response = await GET(getRequest(), context());
  expect(response.status).toBe(200);
  return response.json();
}
function saveBody(state: Draft, fields = selectedFields()) {
  return { revision: state.revision, mode: "sheet", sheetName: state.header.sheetName, fields,
    signature: relevantSheetHeaderSignature(state.header.columns, fields, target.blocks.includes("middle_long")) };
}

beforeEach(() => {
  vi.resetAllMocks(); mocks.preview = false;
  const fields = selectedFields();
  target = {
    id: "target", blocks: ["short"], sheet_name: "B1 synthetic", record_fields: recordFieldsToJson(fields),
    record_fields_version: 3, record_source: "sheet", sheet_header_signature: relevantSheetHeaderSignature(columns, fields, false),
    sheet_transition: { version: "2026-10", mode: "sheet", confirmed_at: "2026-10-15T00:00:00Z",
      legacy: { sheet_name: "old synthetic", record_fields: [], sheet_header_signature: null, record_source: "sheet" } },
  };
  user.mockResolvedValue({ data: { user: { id: "manager" } }, error: null });
  read.select.mockReturnValue(read); read.eq.mockReturnValue(read);
  read.maybeSingle.mockImplementation(async () => ({ data: target, error: null }));
  from.mockReturnValue(read);
  mocks.client.mockResolvedValue({ auth: { getUser: user }, from, rpc });
  mocks.roles.mockResolvedValue(new Map([["manager", [role({ can_manage_members: true }), role({ can_manage_system: true })]]]));
  mocks.member.mockResolvedValue({ name: "B1 synthetic", columns, header: columns.map((column) => column.label), records: [{ memo: "private synthetic record" }] });
  mocks.members.mockResolvedValue([{ name: "B1 synthetic", gid: "1" }, { name: "B2 selected", gid: "2" }]);
  rpc.mockResolvedValue({ data: [{ id: "target", record_fields_version: 4 }], error: null });
});

describe("system administrator member sheet settings API", () => {
  it("loads only current field definitions and the saved sheet's raw headers after verified role authorization", async () => {
    const response = await GET(getRequest(), context());
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(result.fields).toEqual(selectedFields());
    expect(result.header).toEqual({ sheetName: "B1 synthetic", columns, signature: target.sheet_header_signature, memoCandidates: [] });
    expect(result.isMiddleLong).toBe(false);
    expect(Object.keys(result).sort()).toEqual(["fields", "header", "isMiddleLong", "revision"]);
    expect(JSON.stringify(result)).not.toContain("old synthetic");
    expect(JSON.stringify(result)).not.toContain("private synthetic record");
    expect(mocks.roles).toHaveBeenCalledWith(expect.anything(), ["manager"]);
    expect(read.eq).toHaveBeenCalledWith("id", "target");
    expect(mocks.member).toHaveBeenCalledExactlyOnceWith("B1 synthetic", { spreadsheetId: OCTOBER_SHEET_ID });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each([
    { label: "ordinary member", roles: [role()] },
    { label: "member manager", roles: [role({ name: "管理者", can_manage_members: true })] },
    { label: "suppressed system role", roles: [role({ can_manage_system: true, permissions_suppressed: true })] },
  ])("rejects a $label before accessing the target or service client", async ({ roles }) => {
    mocks.roles.mockResolvedValue(new Map([["manager", roles]]));
    expect((await GET(getRequest(), context())).status).toBe(403);
    expect((await POST(postRequest({}), context())).status).toBe(403);
    expect(from).not.toHaveBeenCalled(); expect(mocks.member).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("requires verified identity, rejects preview mode, and fails closed on role loading errors", async () => {
    user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(getRequest(), context())).status).toBe(401);
    expect((await POST(postRequest({}), context())).status).toBe(401);
    user.mockResolvedValue({ data: { user: { id: "manager" } }, error: null }); mocks.preview = true;
    expect((await POST(postRequest({}), context())).status).toBe(403);
    mocks.preview = false; mocks.roles.mockRejectedValue(new Error("unavailable"));
    expect((await GET(getRequest(), context())).status).toBe(503);
    expect(from).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("rejects a different or missing Origin before accessing authentication", async () => {
    expect((await POST(postRequest({}, "https://other.example.invalid"), context())).status).toBe(403);
    expect((await POST(new Request(url, { method: "POST", body: "{}" }), context())).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each(["off", "missing", "old confirmation", "no sheet"])("can read %s settings without Google while keeping the default editor restricted", async (kind) => {
    if (kind === "off") target.sheet_transition = { ...target.sheet_transition as object, mode: "off" };
    if (kind === "missing") target.sheet_transition = null;
    if (kind === "old confirmation") target.sheet_transition = { ...target.sheet_transition as object, confirmed_at: "2026-09-01T00:00:00Z" };
    if (kind === "no sheet") target.sheet_name = null;
    expect((await GET(getRequest(), context())).status).toBe(409);
    const response = await GET(getRequest("?view=settings"), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sheetName: target.sheet_name, fields: selectedFields(), signature: target.sheet_header_signature });
    expect(mocks.member).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("does not turn failed profile or sheet retrieval into a missing or unconfigured member", async () => {
    read.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error("connection lost") });
    expect((await GET(getRequest(), context())).status).toBe(503);
    mocks.member.mockRejectedValue(new Error("CSV unavailable"));
    expect((await GET(getRequest(), context())).status).toBe(503);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("returns a signature for the current fields and live headers when the stored signature is stale", async () => {
    target.sheet_header_signature = "stale stored signature";
    const state = await draft();
    expect(state.header.signature).toBe(relevantSheetHeaderSignature(columns, state.fields, false));
    expect(state.header.signature).not.toBe(target.sheet_header_signature);
  });

  it("returns the latest block category when reloading a changed member configuration", async () => {
    const initial = await draft();
    expect(initial.isMiddleLong).toBe(false);
    target.blocks = ["middle_long", "short"];
    const latest = await draft();
    expect(latest.isMiddleLong).toBe(true);
    expect(latest.revision).not.toBe(initial.revision);
  });

  it("reads saved settings without any Google request even when the old sheet is unavailable", async () => {
    target.sheet_transition = null; target.sheet_name = null; target.sheet_header_signature = null;
    target.record_source = "app"; target.record_fields = [{ key: "custom", label: "本人の独自項目", type: "text" }];
    mocks.member.mockRejectedValue(new Error("Google unavailable")); mocks.members.mockRejectedValue(new Error("Google unavailable"));
    const response = await GET(getRequest("?view=settings"), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fields: target.record_fields, mode: null, sheetName: null, signature: null, isMiddleLong: false });
    expect(mocks.member).not.toHaveBeenCalled(); expect(mocks.members).not.toHaveBeenCalled();
  });

  it("lists sheets only from the October workbook after authorizing and reading the target", async () => {
    const response = await GET(getRequest("?view=members&spreadsheetId=untrusted"), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ members: [{ name: "B1 synthetic", gid: "1" }, { name: "B2 selected", gid: "2" }] });
    expect(mocks.members).toHaveBeenCalledExactlyOnceWith(OCTOBER_SHEET_ID);
    expect(mocks.member).not.toHaveBeenCalled();
  });

  it.each(["off", "unconfigured"])("can inspect a selected sheet while the member is %s", async (kind) => {
    target.sheet_transition = kind === "off" ? { ...target.sheet_transition as object, mode: "off" } : null;
    mocks.member.mockResolvedValue({ name: "B2 selected", columns });
    const response = await GET(getRequest("?sheetName=B2%20selected"), context());
    expect(response.status).toBe(200);
    expect((await response.json()).header.sheetName).toBe("B2 selected");
    expect(mocks.member).toHaveBeenCalledExactlyOnceWith("B2 selected", { spreadsheetId: OCTOBER_SHEET_ID });
  });

  it("distinguishes a missing target and a failed target read for the settings and sheet-list views", async () => {
    for (const view of ["settings", "members"]) {
      read.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      expect((await GET(getRequest(`?view=${view}`), context())).status).toBe(404);
      read.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error("unavailable") });
      expect((await GET(getRequest(`?view=${view}`), context())).status).toBe(503);
    }
    expect(mocks.member).not.toHaveBeenCalled(); expect(mocks.members).not.toHaveBeenCalled();
  });

  it("does not treat a failed external sheet list as an empty list", async () => {
    mocks.members.mockRejectedValue(new Error("metadata unavailable"));
    const response = await GET(getRequest("?view=members"), context());
    expect(response.status).toBe(503);
    expect((await response.json()).members).toBeUndefined();
  });

  it("saves another member's selected sheet and app-only mode through the authenticated atomic RPC", async () => {
    mocks.roles.mockResolvedValue(new Map([["manager", [role({ can_manage_system: true })]]]));
    target.sheet_transition = { ...target.sheet_transition as object, mode: "app_only" };
    const state = await draft();
    const fields = selectedFields([1, 4, 5], [4, 5]);
    mocks.member.mockResolvedValueOnce({ name: "B2 selected", columns });
    const expected = structuredClone(target);
    const response = await POST(postRequest({ ...saveBody(state, fields), sheetName: "B2 selected", mode: "app_only" }), context());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, version: 4 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("admin_save_member_sheet_setup", {
      p_profile_id: "target", p_expected: expected, p_sheet_name: "B2 selected", p_mode: "app_only",
      p_fields: recordFieldsToJson(fields), p_signature: relevantSheetHeaderSignature(columns, fields, false),
    });
    expect(mocks.member).toHaveBeenCalledTimes(2);
    expect(mocks.member).toHaveBeenLastCalledWith("B2 selected", { spreadsheetId: OCTOBER_SHEET_ID });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("passes a null header signature unchanged in the expected state", async () => {
    target.sheet_header_signature = null;
    const state = await draft();
    expect((await POST(postRequest(saveBody(state)), context())).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("admin_save_member_sheet_setup", expect.objectContaining({ p_expected: expect.objectContaining({ sheet_header_signature: null }) }));
  });

  it("submits the untouched pre-transition settings as the basis for the initial legacy snapshot", async () => {
    target.sheet_transition = null; target.record_source = "app";
    target.sheet_name = "B1 legacy"; target.sheet_header_signature = "legacy signature";
    target.record_fields = [{ key: "old_custom", label: "元の独自項目", type: "number" }];
    const expected = structuredClone(target);
    const response = await GET(getRequest("?view=settings"), context());
    const state = await response.json();
    mocks.member.mockResolvedValue({ name: "B2 selected", columns });
    const fields = selectedFields();
    const save = await POST(postRequest({ revision: state.revision, mode: "sheet", sheetName: "B2 selected", fields,
      signature: relevantSheetHeaderSignature(columns, fields, false), expected: { sheet_name: "untrusted" } }), context());
    expect(save.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("admin_save_member_sheet_setup", expect.objectContaining({
      p_expected: expected, p_sheet_name: "B2 selected", p_mode: "sheet", p_fields: recordFieldsToJson(fields),
    }));
  });

  it("disables linkage without a Google request or replacing the member's saved sheet and fields", async () => {
    const stateResponse = await GET(getRequest("?view=settings"), context());
    const state = await stateResponse.json();
    mocks.member.mockRejectedValue(new Error("Google unavailable"));
    const response = await POST(postRequest({ revision: state.revision, mode: "off", sheetName: "untrusted replacement", fields: ["invalid"], signature: "untrusted" }), context());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("admin_save_member_sheet_setup", {
      p_profile_id: "target", p_expected: target, p_mode: "off", p_sheet_name: "", p_fields: [], p_signature: "",
    });
    expect(mocks.member).not.toHaveBeenCalled(); expect(mocks.members).not.toHaveBeenCalled();
  });

  it("requires mode and complete non-off setup inputs before calling the RPC", async () => {
    const state = await draft();
    const input = saveBody(state);
    expect((await POST(postRequest({ ...input, mode: undefined }), context())).status).toBe(400);
    expect((await POST(postRequest({ ...input, sheetName: undefined }), context())).status).toBe(400);
    expect((await POST(postRequest({ ...input, fields: undefined }), context())).status).toBe(400);
    expect((await POST(postRequest({ ...input, signature: undefined }), context())).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled(); expect(mocks.member).toHaveBeenCalledTimes(1);
  });

  it("never saves an unknown selected sheet when the public lookup rejects it", async () => {
    const state = await draft();
    mocks.member.mockRejectedValue(new Error("selected sheet not found"));
    const response = await POST(postRequest({ ...saveBody(state), sheetName: "arbitrary" }), context());
    expect(response.status).toBe(503); expect((await response.json()).uncertain).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["fields", "version", "sheet", "mode", "blocks", "signature", "record source"])("rejects a changed %s revision before writing", async (kind) => {
    const state = await draft();
    if (kind === "fields") target.record_fields = [];
    if (kind === "version") target.record_fields_version++;
    if (kind === "sheet") target.sheet_name = "B2 different";
    if (kind === "mode") target.sheet_transition = { ...target.sheet_transition as object, mode: "app_only" };
    if (kind === "blocks") target.blocks = ["middle_long"];
    if (kind === "signature") target.sheet_header_signature = "changed";
    if (kind === "record source") target.record_source = "app";
    expect((await POST(postRequest(saveBody(state)), context())).status).toBe(409);
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.member).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["missing source", "invented key", "hidden timeline", "duplicate column", "extra property"])("rejects %s fields without writing", async (kind) => {
    const state = await draft();
    const fields = structuredClone(state.fields);
    if (kind === "missing source") delete fields[0].sourceColumn;
    if (kind === "invented key") fields[0].key = "invented";
    if (kind === "hidden timeline") fields[0].hidden = true;
    if (kind === "duplicate column") fields[1].sourceColumn = fields[0].sourceColumn;
    if (kind === "extra property") Object.assign(fields[0], { unknown: true });
    expect((await POST(postRequest(saveBody(state, fields)), context())).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("rejects more optional timeline fields than the allowed limit", async () => {
    const state = await draft();
    const fields = selectedFields([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect((await POST(postRequest(saveBody(state, fields)), context())).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("requires middle/long fixed fields, limits only additional fields, and guards the block category", async () => {
    const middleColumns = ["日付", "低強度", "流し", "結果", "感想", "睡眠", "振り返り"].map((label, index) => ({ index, label }));
    const fields = buildSheetRecordFields({ columns: middleColumns, selectedColumns: [4, 5], timelineColumns: [4, 5], types: {}, isMiddleLong: true, memoColumn: 4 });
    target.blocks = ["middle_long"]; target.record_fields = recordFieldsToJson(fields);
    mocks.member.mockResolvedValue({ name: "B1 synthetic", columns: middleColumns });
    const state = await draft();
    const missingFixed = fields.filter((field) => field.key !== "strides");
    expect((await POST(postRequest(saveBody(state, missingFixed)), context())).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
    const hiddenFixed = fields.map((field) => field.key === "strides" ? { ...field, showInTimeline: false } : field);
    expect((await POST(postRequest(saveBody(state, hiddenFixed)), context())).status).toBe(400);
    const tooMany = buildSheetRecordFields({ columns: middleColumns, selectedColumns: [4, 5, 6], timelineColumns: [4, 5, 6], types: {}, isMiddleLong: true, memoColumn: 4 });
    expect((await POST(postRequest(saveBody(state, tooMany)), context())).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect((await POST(postRequest(saveBody(state, fields)), context())).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("admin_save_member_sheet_setup", expect.objectContaining({ p_expected: expect.objectContaining({ blocks: ["middle_long"] }) }));
  });

  it("rejects changed source headers or a changed signature after refetching the sheet", async () => {
    const state = await draft();
    mocks.member.mockResolvedValueOnce({ name: "B1 synthetic", columns: columns.map((column) => column.index === 1 ? { ...column, label: "別の見出し" } : column) });
    expect((await POST(postRequest(saveBody(state)), context())).status).toBe(409);
    expect((await POST(postRequest({ ...saveBody(state), signature: "stale" }), context())).status).toBe(409);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("reports an RPC atomic compare conflict as 409 without resending", async () => {
    const state = await draft();
    rpc.mockResolvedValue({ data: null, error: { code: "PT409" } });
    const response = await POST(postRequest(saveBody(state)), context());
    expect(response.status).toBe(409); expect((await response.json()).uncertain).toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("reports a target removed before the locked RPC read as missing", async () => {
    const state = await draft();
    rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    const response = await POST(postRequest(saveBody(state)), context());
    expect(response.status).toBe(404); expect((await response.json()).uncertain).toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["network error", "RPC error", "null response", "zero rows", "wrong row", "multiple rows"])("reports %s after starting the write as uncertain without resending", async (kind) => {
    const state = await draft();
    if (kind === "network error") rpc.mockRejectedValue(new Error("connection lost"));
    if (kind === "RPC error") rpc.mockResolvedValue({ data: null, error: { code: "08006" } });
    if (kind === "null response") rpc.mockResolvedValue({ data: null, error: null });
    if (kind === "zero rows") rpc.mockResolvedValue({ data: [], error: null });
    if (kind === "wrong row") rpc.mockResolvedValue({ data: [{ id: "other", record_fields_version: 4 }], error: null });
    if (kind === "multiple rows") rpc.mockResolvedValue({ data: [{ id: "target", record_fields_version: 4 }, { id: "other", record_fields_version: 4 }], error: null });
    const response = await POST(postRequest(saveBody(state)), context());
    expect(response.status).toBe(503); expect((await response.json()).uncertain).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a known failover write refusal from an uncertain result", async () => {
    const state = await draft();
    rpc.mockResolvedValue({ data: null, error: { code: "PT503" } });
    const response = await POST(postRequest(saveBody(state)), context());
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ unchanged: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("allows a read to reconcile an applied write whose response was lost without resending it", async () => {
    const state = await draft();
    const fields = selectedFields([1, 4, 5], [4, 5]);
    const input = saveBody(state, fields);
    rpc.mockImplementationOnce(async () => {
      target.record_fields = recordFieldsToJson(fields);
      target.sheet_header_signature = input.signature;
      target.record_fields_version++;
      throw new Error("response lost after commit");
    });
    const response = await POST(postRequest(input), context());
    expect(response.status).toBe(503); expect((await response.json()).uncertain).toBe(true);
    mocks.member.mockRejectedValue(new Error("Google unavailable after save"));
    const savedResponse = await GET(getRequest("?view=settings"), context());
    expect(savedResponse.status).toBe(200);
    const saved = await savedResponse.json();
    expect(saved.fields).toEqual(input.fields);
    expect(saved.signature).toBe(input.signature);
    expect(saved.revision).not.toBe(state.revision);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
