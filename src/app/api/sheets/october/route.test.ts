import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { id: "pilot" } as { id: string } | null, allowed: true, save: vi.fn(), member: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user } }) },
  rpc: (name: string, args?: unknown) => name === "can_manage_system" ? Promise.resolve({ data: state.allowed, error: null }) : state.save(args),
  from: () => { const q = { select: () => q, eq: () => q, single: async () => ({ data: { blocks: ["short"], record_fields: [] }, error: null }) }; return q; },
}) }));
vi.mock("@/lib/sheet-public-csv", () => ({ fetchPublicMember: state.member, fetchPublicSheetMembers: state.list }));
import { GET, POST } from "./route";
import { OCTOBER_SHEET_ID } from "@/lib/sheet-period";
import { relevantSheetHeaderSignature } from "@/lib/sheet-field-config";
const columns = [{ index: 0, label: "日付" }, { index: 1, label: "感想" }];
const fields = [{ key: "memo", label: "感想", type: "text", sourceColumn: 1, sourceHeader: "感想", showInTimeline: true }] as const;
const request = (body: unknown) => new Request("https://example.test/api/sheets/october", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  state.user = { id: "pilot" }; state.allowed = true;
  state.save.mockReset().mockResolvedValue({ error: null });
  state.member.mockReset().mockResolvedValue({ name: "B1 synthetic", columns });
  state.list.mockReset().mockResolvedValue([{ name: "B1 synthetic", gid: "1" }]);
});
describe("system-only October setup API", () => {
  it("rejects unauthenticated and regular members before accessing the workbook", async () => {
    state.user = null;
    expect((await GET(new Request("https://example.test/api/sheets/october"))).status).toBe(401);
    state.user = { id: "member" }; state.allowed = false;
    expect((await POST(request({}))).status).toBe(403);
    expect(state.member).not.toHaveBeenCalled(); expect(state.list).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
  });
  it("reads the supplied workbook without accepting a client-supplied replacement ID", async () => {
    expect((await GET(new Request("https://example.test/api/sheets/october?spreadsheetId=arbitrary"))).status).toBe(200);
    expect(state.list).toHaveBeenCalledWith(OCTOBER_SHEET_ID);
  });
  it("saves app-only mode after verifying the current column signature", async () => {
    const signature = relevantSheetHeaderSignature(columns, [...fields], false);
    expect((await POST(request({ sheetName: "B1 synthetic", fields, mode: "app_only", signature }))).status).toBe(200);
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ p_mode: "app_only", p_sheet_name: "B1 synthetic", p_signature: signature }));
  });
  it("keeps settings unchanged if columns moved while the form was open", async () => {
    expect((await POST(request({ sheetName: "B1 synthetic", fields, mode: "sheet", signature: "stale" }))).status).toBe(409);
    expect(state.save).not.toHaveBeenCalled();
  });
});
