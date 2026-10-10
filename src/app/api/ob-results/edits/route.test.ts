import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
import { POST } from "./route";
import { obSheetEditSource, obSheetPersonKey } from "@/lib/ob-sheet-edits";
import { obResultsStatusToken, obResultsFeedToken } from "@/lib/ob-results-feed-auth";
const secret = "synthetic-edit-secret", requestId = "00000000-0000-4000-8000-000000000001";
const entry = { id: "00000000-0000-4000-8000-000000000002", meet_key: "ob-2026", submitted_name: "架空参加者", grade: "B1", events: ["男子100m"], revision: 3, profile_id: null, imported_at: "", qualification_marks: {} };
const context = obSheetEditSource([entry], [], secret).editContext;
const change = { key: obSheetPersonKey(entry.id, secret), family: "300m", division: "男子", status: "出場", position: true, group: 2, order: 3, heatScope: "混合" };
const body = () => ({ requestId, dryRun: false, context, changes: [change] });
function request(input: unknown = body(), token = obResultsStatusToken(secret)) { return new Request("https://example.test/api/ob-results/edits", { method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify(input) }); }
beforeEach(() => { vi.stubEnv("SHEET_SYNC_SECRET", secret); state.rpc.mockReset().mockResolvedValue({ data: { requestId, count: 1, dryRun: false }, error: null }); state.revalidate.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
it("allows a signed participant's new event/position and passes only fixed-meet revisions", async () => {
  expect((await POST(request())).status).toBe(200);
  const args = state.rpc.mock.calls[0]; expect(args[0]).toBe("apply_ob_sheet_edits");
  expect(args[1].p_changes[0]).toMatchObject({ entryId: entry.id, entryRevision: 3, event: "男子300m", operationRevision: null, group: 2, order: 3, heatScope: "混合", name: null });
});
it("creates an unlinked new person without requesting contacts or a member profile", async () => {
  const input = { ...body(), changes: [{ ...change, key: "", name: "架空　追加", grade: "OB・OG" }] };
  expect((await POST(request(input))).status).toBe(200);
  expect(state.rpc.mock.calls[0][1].p_changes[0]).toMatchObject({ entryId: null, entryRevision: null, name: "架空　追加", newKey: "架空追加", grade: "OB・OG" });
  expect(JSON.stringify(state.rpc.mock.calls)).not.toMatch(/profile_id|email|phone/);
});
it("rejects read credentials, forged context, unknown participant/event, duplicate rows and invalid lanes before DB access", async () => {
  expect((await POST(request(body(), obResultsFeedToken(secret)))).status).toBe(401);
  for (const input of [{ ...body(), context: context + "x" }, { ...body(), changes: [{ ...change, key: "unknown" }] }, { ...body(), changes: [{ ...change, family: "500m" }] }, { ...body(), changes: [change, change] }, { ...body(), changes: [{ ...change, order: 0 }] }]) expect((await POST(request(input))).status).toBe(400);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("keeps dryRun read-only, proven conflicts distinct from unknown saves, and hides private errors", async () => {
  state.rpc.mockResolvedValueOnce({ data: { requestId, count: 1, dryRun: true }, error: null });
  expect((await POST(request({ ...body(), dryRun: true }))).status).toBe(200); expect(state.revalidate).not.toHaveBeenCalled();
  for (const code of ["40001", "23505", "P0001"]) { state.rpc.mockResolvedValueOnce({ data: null, error: { code, message: "private-data" } }); expect((await POST(request())).status).toBe(409); }
  state.rpc.mockRejectedValueOnce(Error("private-data")); const result = await POST(request()); expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toContain("private-data");
});
