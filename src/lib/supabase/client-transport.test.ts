import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ browserClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: mocks.browserClient }));
import { createClient } from "./client";

const issuer = "https://synthetic-issuer.supabase.co";
const origin = "https://pc-app.example.test";
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_PC_APP_RUNTIME", "true"); vi.stubEnv("NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW", "false");
  vi.stubEnv("NEXT_PUBLIC_CLOUD_AUTH_URL", issuer); vi.stubEnv("NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY", "synthetic-cloud-anon");
  vi.stubEnv("NEXT_PUBLIC_CLOUD_AUTH_MODE", "production"); vi.stubEnv("NEXT_PUBLIC_PC_REST_RELAY_ORIGIN", "https://legacy-relay.example.test");
  vi.stubGlobal("window", { location: { origin } });
  mocks.browserClient.mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function transport(): typeof fetch {
  createClient();
  const [url, key, options] = mocks.browserClient.mock.calls[0];
  expect(url).toBe(issuer); expect(key).toBe("synthetic-cloud-anon");
  expect(options.cookieOptions).toEqual({ name: "sb-tuat-auth" });
  return options.global.fetch;
}

describe("browser PC app client", () => {
  it("uses same-origin REST without the legacy relay or cloud replay", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("unavailable", { status: 503, headers: { "x-tuat-backend": "cloud" } }));
    vi.stubGlobal("fetch", fetcher);
    const call = transport();
    const response = await call(`${issuer}/rest/v1/tweets?select=id`, { method: "POST", body: "{}" });
    expect(response.status).toBe(503); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(`${origin}/api/pc-supabase/rest/v1/tweets?select=id`);
  });
  it("keeps Auth on cloud and refuses accidental SSR cloud data access", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({})); vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("window", undefined);
    const call = transport();
    await call(`${issuer}/auth/v1/user`);
    expect(fetcher.mock.calls[0][0]).toBe(`${issuer}/auth/v1/user`);
    await expect(call(`${issuer}/rest/v1/tweets?select=id`)).rejects.toThrow("server Supabase client");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
