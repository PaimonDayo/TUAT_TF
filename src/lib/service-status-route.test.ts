import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), roles: vi.fn(), status: vi.fn(), cookie: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/supabase/auth", () => ({ fetchRolesByProfileIds: mocks.roles }));
vi.mock("@/lib/service-status", () => ({ getServiceStatus: mocks.status }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
import { GET } from "@/app/api/admin/services/route";

beforeEach(() => {
  mocks.user.mockResolvedValue({ data: { user: { id: "admin" } }, error: null });
  mocks.roles.mockResolvedValue(new Map([["admin", [{ can_manage_system: true }]]]));
  mocks.cookie.mockReturnValue(undefined);
  mocks.status.mockResolvedValue({ checkedAt: "2026-09-06T00:00:00Z" });
});
describe("admin services access", () => {
  it("rejects unauthenticated requests before querying providers", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET()).status).toBe(401);
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("rejects member managers and member previews", async () => {
    mocks.roles.mockResolvedValueOnce(new Map([["admin", [{ can_manage_members: true }]]]));
    expect((await GET()).status).toBe(403);
    mocks.cookie.mockReturnValue({ value: "1" });
    expect((await GET()).status).toBe(403);
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("returns private uncached responses only to system admins", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(mocks.status).toHaveBeenCalledOnce();
  });
  it("never includes internal errors or tokens in a failed response", async () => {
    mocks.status.mockRejectedValue(new Error("secret-token"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-token");
  });
});
