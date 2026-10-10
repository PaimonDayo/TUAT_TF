import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
import { POST } from "./route";
import { obResultsFeedToken, obResultsStatusToken } from "@/lib/ob-results-feed-auth";
import { signObSheetTarget } from "@/lib/ob-sheet-status";
const secret = "synthetic-secret";
const requestId = "00000000-0000-4000-8000-000000000001";
const target = { entryId: "00000000-0000-4000-8000-000000000002", event: "男子100m", entryRevision: 2, operationRevision: 3 };
const body = () => ({ requestId, dryRun: false, changes: [{ token: signObSheetTarget(target, secret), status: "DNS（欠場）" }] });
function request(input = body(), token = obResultsStatusToken(secret)) {
  return new Request("https://example.test/api/ob-results/status", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
}
beforeEach(() => {
  vi.stubEnv("SHEET_SYNC_SECRET", secret);
  state.rpc.mockReset().mockResolvedValue({ data: { requestId, count: 1, dryRun: false }, error: null });
  state.revalidate.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
it("rejects the read token, raw key, tampered identity, arbitrary events and non-status input before DB access", async () => {
  for (const token of [secret, obResultsFeedToken(secret), ""]) expect((await POST(request(body(), token))).status).toBe(401);
  let input = body(); input.changes[0].token += "bad";
  expect((await POST(request(input))).status).toBe(400);
  input = body(); input.changes[0].status = "削除";
  expect((await POST(request(input))).status).toBe(400);
  input = body(); input.changes[0].token = signObSheetTarget({ ...target, event: "その他" }, secret);
  expect((await POST(request(input))).status).toBe(400);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("passes only signed target revisions and canonical status to the atomic fixed-meet RPC", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith("apply_ob_sheet_statuses", { p_request_id: requestId, p_dry_run: false, p_changes: [{ ...target, status: "DNS" }] });
  expect(state.revalidate).toHaveBeenCalled();
});
it("supports dryRun without invalidation and rejects duplicated targets", async () => {
  const input = body(); input.dryRun = true;
  state.rpc.mockResolvedValue({ data: { requestId, count: 1, dryRun: true }, error: null });
  expect((await POST(request(input))).status).toBe(200);
  expect(state.revalidate).not.toHaveBeenCalled();
  state.rpc.mockClear(); input.changes.push(input.changes[0]);
  expect((await POST(request(input))).status).toBe(400);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("distinguishes a proven conflict from an unknown save and does not resubmit either", async () => {
  state.rpc.mockResolvedValueOnce({ data: null, error: { code: "40001", message: "private details" } });
  expect((await POST(request())).status).toBe(409);
  state.rpc.mockResolvedValueOnce({ data: null, error: { code: "", message: "private details" } });
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("private details");
  expect(state.rpc).toHaveBeenCalledTimes(2);
});
