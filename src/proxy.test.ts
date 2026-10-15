import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { unstable_doesMiddlewareMatch as unstable_doesProxyMatch } from "next/experimental/testing/server";
import { config, proxy } from "./proxy";

const mocks = vi.hoisted(() => ({ session: vi.fn(), trial: vi.fn(), maintenance: vi.fn() }));
vi.mock("@/lib/supabase/middleware", () => ({ updateSession: mocks.session }));
vi.mock("@/lib/pc-vercel-proxy", () => ({ pcVercelProxy: mocks.trial }));
vi.mock("@/lib/maintenance", () => ({ isMaintenanceWindow: mocks.maintenance }));

const canonical = "https://tuat-pc-app.track-app.workers.dev";
const legacy = "https://tuat-tf.vercel.app";
const request = (path: string, method = "GET", headers: HeadersInit = {}) => new NextRequest(legacy + path, { method, headers });
beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("PC_APP_RELEASE_ID", "");
  vi.stubEnv("PC_TRIAL_VERCEL", "false");
  mocks.session.mockResolvedValue(NextResponse.next());
  mocks.trial.mockResolvedValue(null);
  mocks.maintenance.mockReturnValue(false);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("moves old production reads to the fixed origin without forwarding query, cookies or host", async () => {
  vi.stubEnv("PC_TRIAL_VERCEL", "true");
  mocks.maintenance.mockReturnValue(true);
  for (const method of ["GET", "HEAD"]) {
    const response = await proxy(request("/records/member?access_token=private-token&next=https://evil.invalid", method, {
      host: "evil.invalid", "x-forwarded-host": "evil.invalid", cookie: "old-session=private-cookie",
    }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(canonical + "/records/member");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await response.text()).not.toContain("private-");
  }
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.trial).not.toHaveBeenCalled();
  expect(mocks.maintenance).not.toHaveBeenCalled();
});

it("sends old login and OAuth callbacks to a new login without copying credentials", async () => {
  for (const path of ["/login", "/auth/callback", "/auth/google/callback", "/api/pc-supabase/auth/v1/callback"]) {
    const response = await proxy(request(path + "?code=private-code&token_hash=private-hash&next=//evil.invalid"));
    expect(response.headers.get("location")).toBe(canonical + "/login");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  }
});

it("refuses every non-read method before any API, session or trial dispatch", async () => {
  vi.stubEnv("PC_TRIAL_VERCEL", "true");
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "PROPFIND"]) {
    for (const path of ["/api/pc-supabase/rest/v1/records", "/api/version", "/sw.js", "/icon.png", "/_next/static/chunk.js"]) {
      const input = request(path, method, { authorization: "Bearer private-key" });
      const response = await proxy(input);
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.has("location")).toBe(false);
      expect(await response.json()).toEqual({ error: "アプリのURLが変わりました。新しいURLを開いてください。", url: canonical });
      expect(input.bodyUsed).toBe(false);
    }
  }
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.trial).not.toHaveBeenCalled();
});

it("preserves old production version reads for deployment SHA verification", async () => {
  for (const method of ["GET", "HEAD"]) {
    const response = await proxy(request("/api/version?check=commit", method));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.has("location")).toBe(false);
  }
  expect(mocks.session).not.toHaveBeenCalled();
});

it("covers all paths so a write cannot bypass cutover through an asset exclusion", () => {
  for (const path of ["/", "/api/version", "/_next/static/chunk.js", "/_next/image", "/icon.png", "/manifest.webmanifest", "/auth/callback"]) {
    expect(unstable_doesProxyMatch({ config, nextConfig: {}, url: legacy + path })).toBe(true);
  }
});

it("keeps native, development and preview authentication on the existing session path", async () => {
  for (const [vercel, release] of [["production", "pc-native-release"], ["preview", ""], ["development", ""], [undefined, ""]]) {
    vi.stubEnv("VERCEL_ENV", vercel);
    vi.stubEnv("PC_APP_RELEASE_ID", release);
    const input = new NextRequest(canonical + "/auth/callback?code=native-code");
    expect((await proxy(input)).headers.get("x-middleware-next")).toBe("1");
    expect(mocks.session).toHaveBeenLastCalledWith(input);
  }
  expect(mocks.session).toHaveBeenCalledTimes(4);
});

it("keeps the previous static exclusions without triggering preview authentication or trial fetches", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PC_TRIAL_VERCEL", "true");
  for (const path of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/icon.png", "/apple-icon", "/manifest.webmanifest", "/image.webp"]) {
    expect((await proxy(request(path))).headers.get("x-middleware-next")).toBe("1");
  }
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.trial).not.toHaveBeenCalled();
});

it("retains preview trial gates and normal maintenance handling", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PC_TRIAL_VERCEL", "true");
  const gate = NextResponse.json({ error: "trial" }, { status: 401 });
  mocks.trial.mockResolvedValue(gate);
  expect(await proxy(request("/api/records", "POST"))).toBe(gate);
  vi.stubEnv("PC_TRIAL_VERCEL", "false");
  mocks.maintenance.mockReturnValue(true);
  expect((await proxy(request("/home"))).headers.get("x-middleware-rewrite")).toBe(legacy + "/maintenance");
  expect(mocks.session).not.toHaveBeenCalled();
});
