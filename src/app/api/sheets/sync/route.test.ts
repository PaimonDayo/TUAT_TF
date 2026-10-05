import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "administrator" } as { id: string } | null,
  canManage: true,
  sync: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user } }) },
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from() {
    const query = {
      update: () => query, insert: () => query, select: () => query,
      eq: () => query, lt: () => query,
      single: async () => ({ data: { id: "sync-run" }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  },
}) }));
vi.mock("@/lib/supabase/auth", () => ({ fetchRolesByProfileIds: async () => new Map() }));
vi.mock("@/lib/permissions", () => ({ permissionsOf: () => ({ manageMembers: state.canManage }) }));
vi.mock("@/lib/sheet-sync", () => ({ runSheetSync: state.sync }));
vi.mock("@/lib/pc-cron-forward", () => ({ forwardPcCron: vi.fn() }));
import { POST } from "./route";

function request(cron: boolean, dryRun = false) {
  return new Request("https://example.test/api/sheets/sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cron ? { authorization: "Bearer synthetic-sync" } : {}) },
    body: JSON.stringify({ onlySheet: "B1 test", dryRun, includeToday: true }),
  });
}

beforeEach(() => {
  state.user = { id: "administrator" };
  state.canManage = true;
  state.sync.mockReset().mockResolvedValue({ inserted: 0, updated: 0, pushed: 0, sheetReplies: 0,
    unchangedMembers: [], failedMembers: [], conflicts: [], skippedMembers: [] });
  vi.stubEnv("SHEET_SYNC_SECRET", "synthetic-sync");
  vi.stubEnv("SHEET_SYNC_ENABLED", "true");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("sheet sync publication boundary", () => {
  it.each([false, true])("uses the prior-day cutoff for authenticated cron, including dryRun=%s", async dryRun => {
    state.user = null;
    expect((await POST(request(true, dryRun))).status).toBe(200);
    expect(state.sync).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ includeToday: false, dryRun }));
  });

  it("allows an authorized administrator's manual pull to include today", async () => {
    expect((await POST(request(false))).status).toBe(200);
    expect(state.sync).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ includeToday: true }));
  });

  it("requires authentication and member-management permission before a manual pull", async () => {
    state.user = null;
    expect((await POST(request(false, true))).status).toBe(401);
    state.user = { id: "administrator" };
    state.canManage = false;
    expect((await POST(request(false, true))).status).toBe(403);
    expect(state.sync).not.toHaveBeenCalled();
  });
});
