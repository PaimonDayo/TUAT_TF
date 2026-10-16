import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { id: "u" } as { id: string } | null, preview: false, rpc: vi.fn(), protection: null as Response | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, rpc: state.rpc }) }));
vi.mock("@/lib/supabase/auth", () => ({ isMemberPreviewActive: async () => state.preview }));
vi.mock("@/lib/pc-backup-status", () => ({ pcAppWriteProtectionResponse: async () => state.protection, pcBackupProtectionResponse: () => null }));
import { POST } from "./route";
const id = "10000000-0000-4000-8000-000000000001";
const req = (kind = "app") => new Request("http://localhost/api/comments/delete", { method: "POST", body: JSON.stringify({ id, kind }) });
beforeEach(() => { state.user = { id: "u" }; state.preview = false; state.protection = null; state.rpc.mockReset().mockResolvedValue({ data: id, error: null }); });
it("denies anonymous and preview before mutations", async () => {
  state.user = null; expect((await POST(req())).status).toBe(403);
  state.user = { id: "u" }; state.preview = true; expect((await POST(req())).status).toBe(403);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("retires historical spreadsheet deletions without dispatching or draining receipts", async () => {
  expect((await POST(req("sheet"))).status).toBe(410);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("preserves write protection and caller ownership/moderator checks", async () => {
  state.protection = new Response(null, { status: 503 });
  expect((await POST(req())).status).toBe(503); expect(state.rpc).not.toHaveBeenCalled();
  state.protection = null; state.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect((await POST(req())).status).toBe(403);
});
it("requires the exact app comment deletion result and does not report zero rows as success", async () => {
  expect(await (await POST(req())).json()).toEqual({ ok: true });
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("delete_comment_with_sheet", { p_id: id, p_kind: "app" });
  state.rpc.mockResolvedValue({ data: null, error: null });
  expect((await POST(req())).status).toBe(404);
});
it("does not replay an unknown deletion outcome", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { code: "NETWORK" } });
  expect((await POST(req())).status).toBe(409);
  expect(state.rpc).toHaveBeenCalledOnce();
});
