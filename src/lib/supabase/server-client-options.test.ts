import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionClientConfig } from "./server-client-options";

const origin = "https://pc-app.example.test";
const issuer = "https://synthetic-issuer.supabase.co";
beforeEach(() => {
  for (const [name, value] of Object.entries({ PC_APP_RUNTIME: "true", NEXT_PUBLIC_PC_APP_RUNTIME: "true",
    PC_BACKEND_ENABLED: "true", NEXT_PUBLIC_PC_BACKEND: "true", PC_BACKEND_INTERNAL_URL: "http://127.0.0.1:8000",
    APP_PUBLIC_ORIGIN: origin, NEXT_PUBLIC_SUPABASE_URL: `${origin}/api/pc-supabase`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-local-anon",
    NEXT_PUBLIC_CLOUD_AUTH_URL: issuer, NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY: "synthetic-cloud-anon", NEXT_PUBLIC_CLOUD_AUTH_MODE: "production",
    VERCEL: "", VERCEL_ENV: "", PC_TRIAL_VERCEL: "false", NEXT_PUBLIC_PC_TRIAL: "false", NEXT_PUBLIC_PC_REST_RELAY_ORIGIN: "",
    PC_APP_SYNTHETIC_REVIEW: "false", NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW: "false",
  })) vi.stubEnv(name, value);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("server PC app transport", () => {
  it("keeps cloud session cookies and member JWT while REST goes straight to private loopback", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([])); vi.stubGlobal("fetch", fetcher);
    const config = sessionClientConfig();
    expect(config.url).toBe(issuer); expect(config.key).toBe("synthetic-cloud-anon");
    expect(config.options.cookieOptions).toEqual({ name: "sb-tuat-auth" });
    const transport = (config.options.global as { fetch: typeof fetch }).fetch;
    await transport(`${issuer}/rest/v1/tweets?select=id`, { headers: { authorization: "Bearer synthetic-member", apikey: "synthetic-cloud-anon",
      cookie: "synthetic=private", "x-pc-backend-key": "caller", "x-tuat-mirror": "true", "x-forwarded-host": "attacker.test" } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/rest/v1/tweets?select=id");
    const headers = new Headers(init?.headers);
    expect(headers.get("apikey")).toBe("synthetic-local-anon"); expect(headers.get("authorization")).toBe("Bearer synthetic-member");
    for (const name of ["cookie", "x-pc-backend-key", "x-tuat-mirror", "x-forwarded-host"]) expect(headers.has(name)).toBe(false);
    await transport(`${issuer}/auth/v1/user`, { headers: { apikey: "synthetic-cloud-anon", authorization: "Bearer synthetic-member" } });
    expect(fetcher.mock.calls[1][0]).toBe(`${issuer}/auth/v1/user`);
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("apikey")).toBe("synthetic-cloud-anon");
  });
  it("keeps a loopback failure from triggering endpoint discovery or cloud replay", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private API unavailable")); vi.stubGlobal("fetch", fetcher);
    const transport = (sessionClientConfig().options.global as { fetch: typeof fetch }).fetch;
    await expect(transport(`${issuer}/rest/v1/tweets`, { method: "POST", body: "{}" })).rejects.toThrow("private API unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:8000/rest/v1/tweets");
  });
});
