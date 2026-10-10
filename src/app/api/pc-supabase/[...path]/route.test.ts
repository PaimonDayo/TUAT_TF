import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ backend: vi.fn(), available: vi.fn() }));
vi.mock("@/lib/pc-backend", () => ({ pcBackendFetch: mocks.backend, pcAvailable: mocks.available }));
import { GET, POST } from "./route";

const origin = "https://pc-app.example.test";
const subject = "17cac21b-28a3-4e61-b7fd-96a6d6c20460";
function bearer(role = "authenticated") { return `Bearer x.${Buffer.from(JSON.stringify({ role, sub: subject })).toString("base64url")}.x`; }
beforeEach(() => {
  for (const [name, value] of Object.entries({ PC_APP_RUNTIME: "true", NEXT_PUBLIC_PC_APP_RUNTIME: "true",
    PC_BACKEND_ENABLED: "true", NEXT_PUBLIC_PC_BACKEND: "true", PC_BACKEND_INTERNAL_URL: "http://127.0.0.1:8000",
    APP_PUBLIC_ORIGIN: origin, NEXT_PUBLIC_SUPABASE_URL: `${origin}/api/pc-supabase`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-local-anon", NEXT_PUBLIC_CLOUD_AUTH_URL: "https://synthetic-issuer.supabase.co",
    NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY: "synthetic-cloud-anon", NEXT_PUBLIC_CLOUD_AUTH_MODE: "production",
    VERCEL: "", VERCEL_ENV: "", NEXT_PUBLIC_PC_TRIAL: "false", PC_TRIAL_VERCEL: "false",
    NEXT_PUBLIC_PC_REST_RELAY_ORIGIN: "", PC_APP_SYNTHETIC_REVIEW: "false", NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW: "false",
  })) vi.stubEnv(name, value);
  mocks.backend.mockReset().mockResolvedValue(Response.json([{ id: "synthetic" }]));
  mocks.available.mockReset().mockResolvedValue(false);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("same-origin PC app public REST boundary", () => {
  it("accepts the configured public Origin through loopback without forwarding caller privilege headers", async () => {
    const response = await POST(new Request("http://127.0.0.1:18182/api/pc-supabase/rest/v1/tweets", { method: "POST",
      headers: { origin, authorization: bearer(), apikey: "privileged-caller-key", "x-pc-backend-key": "caller-key",
        "x-pc-app-key": "caller-app-key", "x-tuat-mirror": "true", "x-forwarded-host": "attacker.test",
        cookie: "synthetic=private", "content-type": "application/json", prefer: "return=representation" }, body: '{"id":"synthetic"}' }));
    expect(response.status).toBe(200);
    expect(mocks.available).not.toHaveBeenCalled();
    const [target, options] = mocks.backend.mock.calls[0];
    expect(target).toBe(`${origin}/api/pc-supabase/rest/v1/tweets`);
    expect(options.headers.get("apikey")).toBe("synthetic-local-anon");
    expect(options.headers.get("authorization")).toBe(bearer());
    expect(options.headers.get("prefer")).toBe("return=representation");
    for (const name of ["cookie", "origin", "x-pc-backend-key", "x-pc-app-key", "x-tuat-mirror", "x-forwarded-host"]) expect(options.headers.has(name)).toBe(false);
  });
  it("rejects cross-origin mutations, anonymous and privileged REST before data dispatch", async () => {
    const cases: HeadersInit[] = [
      { origin: "https://attacker.test", authorization: bearer() },
      { origin, authorization: bearer("service_role") }, { origin, authorization: bearer("anon") }, { origin },
    ];
    for (const headers of cases) {
      const response = await POST(new Request(`${origin}/api/pc-supabase/rest/v1/tweets`, { method: "POST", headers }));
      expect([401, 403]).toContain(response.status);
    }
    expect(mocks.backend).not.toHaveBeenCalled();
  });
  it("does not expose private Auth even for an authenticated member", async () => {
    for (const path of ["/auth/v1/user", "/auth/v1/token?grant_type=refresh_token", "/auth/v1/admin/users"]) {
      const response = await GET(new Request(`${origin}/api/pc-supabase${path}`, { headers: { authorization: bearer() } }));
      expect(response.status).toBe(403);
    }
    expect(mocks.backend).not.toHaveBeenCalled();
  });
  it("reports an unavailable save once and never contacts cloud business data", async () => {
    const external = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", external);
    mocks.backend.mockRejectedValue(new Error("response lost after commit"));
    const response = await POST(new Request(`${origin}/api/pc-supabase/rest/v1/tweets`, { method: "POST",
      headers: { origin, authorization: bearer() }, body: '{"id":"synthetic"}' }));
    expect(response.status).toBe(503); expect(response.headers.get("x-tuat-backend")).toBeNull();
    expect(mocks.backend).toHaveBeenCalledTimes(1); expect(mocks.available).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
  });
  it("retains the existing legacy fallback when the new deployment flags are off", async () => {
    vi.stubEnv("PC_APP_RUNTIME", "false"); vi.stubEnv("NEXT_PUBLIC_PC_APP_RUNTIME", "false"); vi.stubEnv("PC_BACKEND_INTERNAL_URL", "");
    const external = vi.fn<typeof fetch>().mockResolvedValue(Response.json([])); vi.stubGlobal("fetch", external);
    const response = await GET(new Request(`${origin}/api/pc-supabase/rest/v1/tweets`, { headers: { authorization: bearer() } }));
    expect(response.status).toBe(200); expect(response.headers.get("x-tuat-backend")).toBe("cloud");
    expect(mocks.backend).not.toHaveBeenCalled(); expect(external).toHaveBeenCalledTimes(1);
  });
});
