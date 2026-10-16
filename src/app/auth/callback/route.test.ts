import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), lookup: vi.fn(), create: vi.fn(), access: vi.fn(),
  signOut: vi.fn(), profile: vi.fn(), upsert: vi.fn(), available: vi.fn(), runtime: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/login-access", () => ({ loginAccessStatus: mocks.access }));
vi.mock("@/lib/pc-backend", () => ({ pcAvailable: mocks.available }));
vi.mock("@/lib/pc-app-runtime", () => ({ getPcAppRuntime: mocks.runtime }));
import { GET } from "./route";

const id = "17cac21b-28a3-4e61-b7fd-96a6d6c20460";
const user = { id, email: "allowed-external@example.test", user_metadata: { name: "Synthetic" } };
const origin = "https://pc-app.example.test";
const request = () => new NextRequest("http://127.0.0.1:18182/auth/callback?code=synthetic&next=%2Fhome");
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("APP_PUBLIC_ORIGIN", origin);
  mocks.runtime.mockReturnValue({ cloud: { url: "https://issuer.supabase.co", anonKey: "synthetic-public" } });
  mocks.access.mockResolvedValue("allowed"); mocks.available.mockResolvedValue(true);
  mocks.lookup.mockReset().mockResolvedValue({ data: { user }, error: null });
  mocks.create.mockReset().mockResolvedValue({ data: { user }, error: null });
  mocks.profile.mockReset().mockResolvedValue({ data: { id, display_name: "Synthetic", blocks: ["middle"] }, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.admin.mockReturnValue({ auth: { admin: { getUserById: mocks.lookup, createUser: mocks.create } } });
  mocks.client.mockResolvedValue({ auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user } }), signOut: mocks.signOut },
    from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: mocks.profile })) })), upsert: mocks.upsert })) });
});
afterEach(() => vi.unstubAllEnvs());

describe("PC app first-login identity", () => {
  it("keeps the completed OAuth login on the public application origin", async () => {
    for (const next of ["@other.invalid/", "//other.invalid/", "/\\other.invalid/"]) {
      const response = await GET(new NextRequest(`http://127.0.0.1:18182/auth/callback?code=synthetic&next=${encodeURIComponent(next)}`));
      expect(response.headers.get("location")).toBe(`${origin}/home`);
    }
  });
  it("checks allowlist before immediately provisioning the verified user's same UUID", async () => {
    mocks.lookup.mockResolvedValueOnce({ data: { user: null }, error: { status: 404, code: "user_not_found" } });
    const response = await GET(request());
    expect(response.headers.get("location")).toBe(`${origin}/home`);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ id, email: user.email, email_confirm: true });
    expect(mocks.access.mock.invocationCallOrder[0]).toBeLessThan(mocks.lookup.mock.invocationCallOrder[0]);
    expect(mocks.lookup.mock.calls[0][0]).toBe(id);
  });
  it("does not provision denied external users or erase valid sessions on an unavailable allowlist", async () => {
    mocks.access.mockResolvedValueOnce("denied");
    const denied = await GET(request());
    expect(denied.headers.get("location")).toBe(`${origin}/login?error=domain`);
    expect(mocks.signOut).toHaveBeenCalledTimes(1); expect(mocks.admin).not.toHaveBeenCalled();
    mocks.signOut.mockClear(); mocks.access.mockResolvedValueOnce("unavailable");
    expect((await GET(request())).status).toBe(503);
    expect(mocks.signOut).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each([
    { data: { user: null }, error: { status: 503 } }, { data: { user: null }, error: null },
    { data: { user: { ...user, email: "other@example.test" } }, error: null },
  ])("fails closed without creation for unavailable or conflicting lookup %#", async result => {
    mocks.lookup.mockResolvedValueOnce(result);
    expect((await GET(request())).status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.profile).not.toHaveBeenCalled();
  });
  it("reconciles an unknown creation response once without repeating the create", async () => {
    mocks.lookup.mockResolvedValueOnce({ data: { user: null }, error: { status: 404 } })
      .mockResolvedValueOnce({ data: { user }, error: null });
    mocks.create.mockResolvedValueOnce({ data: { user: null }, error: { status: 503 } });
    expect((await GET(request())).headers.get("location")).toBe(`${origin}/home`);
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });
  it("preserves an unresolved creation and session after a failed readback", async () => {
    mocks.lookup.mockResolvedValue({ data: { user: null }, error: { status: 404 } });
    mocks.create.mockResolvedValueOnce({ data: { user: null }, error: { status: 503 } });
    expect((await GET(request())).status).toBe(503);
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.lookup).toHaveBeenCalledTimes(2);
    expect(mocks.profile).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("does not turn profile acquisition failure into profile creation", async () => {
    mocks.profile.mockResolvedValueOnce({ data: null, error: { code: "unavailable" } });
    expect((await GET(request())).status).toBe(503); expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
