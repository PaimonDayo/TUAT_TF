import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), roles: vi.fn(), preview: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), result: vi.fn(), refresh: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/auth", () => ({ fetchRolesByProfileIds: mocks.roles, isMemberPreviewActive: mocks.preview }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { confirmEntryMember, saveEntry, getEntryChanges } from "./actions";
const id = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  mocks.user.mockResolvedValue({ data: { user: { id: "system" } } });
  mocks.roles.mockResolvedValue(new Map([["system", [{ can_manage_system: true }]]]));
  mocks.preview.mockResolvedValue(false);
  const chain = { update: mocks.update, eq: mocks.eq, select: () => chain, maybeSingle: mocks.result };
  mocks.from.mockReturnValue(chain);
  mocks.update.mockReturnValue(chain);
  mocks.eq.mockReturnValue(chain);
  mocks.result.mockResolvedValue({ data: { id }, error: null });
  mocks.rpc.mockResolvedValue({ data: id, error: null });
});

it("rejects entry edits and history reads from ordinary members or preview sessions", async () => {
  const input = { entryId: id, profileId: null, revision: 0, events: ["男子100m"], marks: {} };
  mocks.roles.mockResolvedValue(new Map());
  expect((await saveEntry(input)).ok).toBe(false);
  expect((await getEntryChanges(id)).ok).toBe(false);
  mocks.roles.mockResolvedValue(new Map([["system", [{ can_manage_system: true }]]]));
  mocks.preview.mockResolvedValue(true);
  expect((await saveEntry(input)).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
});

it("does not report success when concurrent editing invalidates a revision", async () => {
  mocks.rpc.mockResolvedValue({ error: { message: "entry_conflict" } });
  expect((await saveEntry({ entryId: id, profileId: null, revision: 0, events: [], marks: {} })).message).toContain("更新されています");
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("refuses anonymous, ordinary members and preview before any data access", async () => {
  mocks.user.mockResolvedValueOnce({ data: { user: null } });
  expect((await confirmEntryMember(id, null, 0)).ok).toBe(false);
  mocks.roles.mockResolvedValueOnce(new Map());
  expect((await confirmEntryMember(id, null, 0)).ok).toBe(false);
  mocks.preview.mockResolvedValueOnce(true);
  expect((await confirmEntryMember(id, null, 0)).ok).toBe(false);
  expect(mocks.from).not.toHaveBeenCalled();
});

it("rejects invalid identifiers and revisions", async () => {
  expect((await confirmEntryMember("invalid", null, 0)).ok).toBe(false);
  expect((await confirmEntryMember(id, null, -1)).ok).toBe(false);
  expect(mocks.user).not.toHaveBeenCalled();
});

it("rejects a missing or inactive target member", async () => {
  mocks.result.mockResolvedValueOnce({ data: null, error: null });
  expect((await confirmEntryMember(id, id, 0)).ok).toBe(false);
  expect(mocks.eq).toHaveBeenCalledWith("status", "active");
  expect(mocks.eq).toHaveBeenCalledWith("approved", true);
  expect(mocks.update).not.toHaveBeenCalled();
});

it("reports a stale revision without reporting success or refreshing", async () => {
  mocks.result.mockResolvedValueOnce({ data: null, error: null });
  const result = await confirmEntryMember(id, null, 3);
  expect(result.ok).toBe(false);
  expect(mocks.eq).toHaveBeenCalledWith("revision", 3);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("preserves uniqueness failures and refreshes only after a successful link change", async () => {
  mocks.result.mockResolvedValueOnce({ data: null, error: { code: "23505" } });
  expect((await confirmEntryMember(id, null, 0)).ok).toBe(false);
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect((await confirmEntryMember(id, null, 0)).ok).toBe(true);
  expect(mocks.refresh).toHaveBeenCalledWith("/ob-entries");
});
