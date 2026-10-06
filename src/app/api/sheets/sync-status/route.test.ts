import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "administrator" } as { id: string } | null,
  canManage: true,
  results: {} as Record<string, { data: unknown; error: unknown; count?: number | null }>,
  admin: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user } }) },
}) }));
vi.mock("@/lib/supabase/auth", () => ({ fetchRolesByProfileIds: async () => new Map() }));
vi.mock("@/lib/permissions", () => ({ permissionsOf: () => ({ manageMembers: state.canManage }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.admin }));

import { GET } from "./route";

const finishedAt = "2026-10-06T15:00:05.123456+00:00";
const failure = { member: "synthetic-member", reason: "POST required" };
const resolvedFailure = {
  ...failure,
  resolved_at: "2026-10-07T06:00:00.000Z",
  resolution: "verified_writable_cells_match",
};

function setRun(failedMembers: unknown, status = "error", finished: string | null = finishedAt) {
  const run = {
    status,
    started_at: "2026-10-06T15:00:00.000Z",
    finished_at: finished,
    pulled_count: 12,
    pushed_count: 2,
    failed_members: failedMembers,
  };
  state.results.sheet_sync_runs = { data: [run], error: null };
  return run;
}

beforeEach(() => {
  state.user = { id: "administrator" };
  state.canManage = true;
  state.results = {
    sheet_sync_runs: { data: [], error: null },
    practice_records: { data: null, count: 1, error: null },
    profiles: { data: null, count: 3, error: null },
  };
  state.admin.mockReset().mockImplementation(() => ({
    from(table: string) {
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        eq: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(state.results[table]).then(resolve),
      };
      return query;
    },
  }));
});

describe("sheet sync health after audited reconciliation", () => {
  it("keeps a fatal run with no member failures visible", async () => {
    setRun([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).latest).toMatchObject({
      status: "error", failedCount: 0, rawFailedCount: 0, resolvedCount: 0, hasIssue: true,
    });
  });

  it("reports only unresolved member failures, while preserving the error run and pending writes", async () => {
    const run = setRun([resolvedFailure]);
    const original = structuredClone(run);
    const response = await GET();
    expect(await response.json()).toMatchObject({
      latest: { status: "error", failedCount: 0, rawFailedCount: 1, resolvedCount: 1, hasIssue: false },
      pendingPushCount: 1,
      sheetProfileCount: 3,
    });
    expect(run).toEqual(original);
  });

  it("keeps a partially reconciled run visible", async () => {
    setRun([resolvedFailure, { ...failure, member: "second-member" }]);
    expect((await (await GET()).json()).latest).toMatchObject({
      failedCount: 1, rawFailedCount: 2, resolvedCount: 1, hasIssue: true,
    });
  });

  it("counts unresolved member failures even when the run status is not error", async () => {
    setRun([failure], "partial");
    expect((await (await GET()).json()).latest).toMatchObject({ failedCount: 1, hasIssue: true });
  });

  it.each([
    ["missing metadata", failure],
    ["unrecognized resolution", { ...resolvedFailure, resolution: "assumed_success" }],
    ["missing resolution timestamp", { ...resolvedFailure, resolved_at: undefined }],
    ["non-string timestamp", { ...resolvedFailure, resolved_at: 1791331200000 }],
    ["invalid timestamp", { ...resolvedFailure, resolved_at: "invalid" }],
    ["timezone-free timestamp", { ...resolvedFailure, resolved_at: "2026-10-07T06:00:00" }],
    ["invalid calendar date", { ...resolvedFailure, resolved_at: "2026-11-31T06:00:00Z" }],
    ["resolution before completion", { ...resolvedFailure, resolved_at: "2026-10-06T15:00:00Z" }],
    ["resolution before completion within the same millisecond", { ...resolvedFailure, resolved_at: "2026-10-06T15:00:05.123455Z" }],
    ["missing member", { ...resolvedFailure, member: undefined }],
    ["missing failure reason", { ...resolvedFailure, reason: undefined }],
    ["non-object failure", null],
  ])("does not suppress %s", async (_label, invalidFailure) => {
    setRun([invalidFailure]);
    expect((await (await GET()).json()).latest).toMatchObject({
      failedCount: 1, resolvedCount: 0, hasIssue: true,
    });
  });

  it.each([null, "invalid", "2026-02-30T15:00:05Z"])("does not resolve a run with invalid completion time %s", async completion => {
    setRun([resolvedFailure], "error", completion);
    expect((await (await GET()).json()).latest).toMatchObject({ failedCount: 1, resolvedCount: 0, hasIssue: true });
  });

  it.each([
    "2026-10-06T15:00:05.123456Z",
    "2026-10-07T00:00:05.123456+09:00",
  ])("accepts a verified resolution exactly at completion: %s", async resolvedAt => {
    setRun([{ ...resolvedFailure, resolved_at: resolvedAt }]);
    expect((await (await GET()).json()).latest).toMatchObject({ failedCount: 0, resolvedCount: 1, hasIssue: false });
  });

  it("keeps the no-run and successful-run states healthy", async () => {
    expect((await (await GET()).json()).latest).toBeNull();
    setRun([], "success");
    expect((await (await GET()).json()).latest).toMatchObject({ failedCount: 0, hasIssue: false });
  });

  it.each(["sheet_sync_runs", "practice_records", "profiles"])("returns a server error when %s cannot be read", async table => {
    state.results[table].error = { message: "synthetic read failure" };
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "同期状態を取得できませんでした" });
  });

  it("requires a verified user and management permission before reading administrator data", async () => {
    state.user = null;
    expect((await GET()).status).toBe(401);
    state.user = { id: "member" };
    state.canManage = false;
    expect((await GET()).status).toBe(403);
    expect(state.admin).not.toHaveBeenCalled();
  });
});
