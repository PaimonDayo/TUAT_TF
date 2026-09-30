import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "owner" } as { id: string } | null,
  comment: { content: "保存済み本文", sheet_reply_index: null } as { content: string; sheet_reply_index: number | null } | null,
  filters: [] as unknown[][],
  admin: vi.fn(), write: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user } }) },
  from(table: string) {
    const q = { select: () => q, eq: (key: string, value: unknown) => { state.filters.push([table, key, value]); return q; }, maybeSingle: async () => ({ data: table === "comments" ? state.comment : { user_id: "record-owner", recorded_date: "2026-09-28" }, error: null }) };
    return q;
  },
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.admin }));
vi.mock("@/lib/sheet-sync", () => ({ writeSheetReply: state.write }));
vi.mock("@/lib/sheet-sync/period-routing", () => ({ sheetForRecord: async () => ({ sheetName: "test-sheet", fields: [] }) }));
import { POST } from "./route";

const commentId = "11111111-1111-4111-8111-111111111111";
const request = (body: unknown) => new Request("https://example.test/api/sheets/reply", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  state.user = { id: "owner" }; state.comment = { content: "保存済み本文", sheet_reply_index: null }; state.filters = [];
  state.write.mockReset().mockResolvedValue(8);
  state.admin.mockReset().mockImplementation(() => ({ from(table: string) {
    const q = { select: () => q, update: () => q, eq: (key: string, value: unknown) => { state.filters.push([table, key, value]); return q; }, maybeSingle: async () => ({ data: { sheet_name: "test-sheet", display_name: "本人" } }), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
    return q;
  } }));
});
describe("sheet replies", () => {
  it("requires authentication and a saved comment ID", async () => {
    state.user = null;
    expect((await POST(request({}))).status).toBe(401);
    state.user = { id: "owner" };
    expect((await POST(request({ recordId: "r", text: "x" }))).status).toBe(400);
    expect(state.admin).not.toHaveBeenCalled();
  });
  it("rejects inaccessible comments before privileged access", async () => {
    state.comment = null;
    expect((await POST(request({ recordId: "r", commentId }))).status).toBe(404);
    expect(state.filters).toContainEqual(["comments", "user_id", "owner"]);
    expect(state.filters).toContainEqual(["comments", "target_id", "r"]);
    expect(state.admin).not.toHaveBeenCalled();
  });
  it("uses DB content and limits the sync update to the same author and content", async () => {
    expect((await POST(request({ recordId: "r", commentId, text: "未保存の別本文" }))).status).toBe(200);
    expect(state.write).toHaveBeenCalledWith("test-sheet", "2026-09-28", "保存済み本文　本人", commentId, undefined);
    expect(state.filters).toContainEqual(["comments", "content", "保存済み本文"]);
  });
  it("does not resend a synchronized comment, including column zero", async () => {
    state.comment!.sheet_reply_index = 0;
    expect((await POST(request({ recordId: "r", commentId }))).status).toBe(200);
    expect(state.write).not.toHaveBeenCalled();
  });
  it("reports missing sheet rows as failure", async () => {
    state.write.mockResolvedValue(null);
    expect((await POST(request({ recordId: "r", commentId }))).status).toBe(502);
  });
});
