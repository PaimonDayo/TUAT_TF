import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { pcVercelProxy } from "./pc-vercel-proxy";

const origin = "https://private-preview.vercel.app";
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("PC_TRIAL_BRIDGE_URL", "https://owner-test.trycloudflare.com/_pc/bridge");
  vi.stubEnv("PC_TRIAL_BRIDGE_KEY", "server-only-bridge-key-01234567890123456789");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); fetchMock.mockReset(); });
const req = (path: string, init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {}) => new NextRequest(origin + path, { ...init, headers: { host: "private-preview.vercel.app", ...init.headers } });
it("keeps anonymous pages and API requests behind the PC owner session", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
  expect((await pcVercelProxy(req("/home")))?.headers.get("location")).toBe(origin + "/_pc/login");
  expect((await pcVercelProxy(req("/api/note-image")))?.status).toBe(401);
});
it("fails closed on an unavailable PC and requires a configured bridge", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 502 }));
  expect((await pcVercelProxy(req("/home")))?.status).toBe(503);
  vi.stubEnv("PC_TRIAL_BRIDGE_KEY", "");
  await expect(pcVercelProxy(req("/home"))).rejects.toThrow("configuration");
});
it("rejects cross-site login and does not relay arbitrary private paths", async () => {
  expect((await pcVercelProxy(req("/_pc/login", { method: "POST", body: "password=test", headers: { origin: "https://evil.invalid" } })))?.status).toBe(403);
  expect((await pcVercelProxy(req("/_pc/bridge/_pc/session")))?.status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("relays the native login response and cookies through Vercel", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 303, headers: { location: "/home", "set-cookie": "__Host-pc-trial=fixture; Path=/; Secure; HttpOnly", "referrer-policy": "same-origin" } }));
  const result = await pcVercelProxy(req("/_pc/login", { method: "POST", body: "password=test", headers: { origin } }));
  expect(result?.status).toBe(303);
  expect(result?.headers.get("location")).toBe(origin + "/home");
  expect(result?.headers.get("set-cookie")).toContain("HttpOnly");
  expect(result?.headers.get("referrer-policy")).toBe("same-origin");
  expect(result?.headers.has("x-pc-trial-bridge")).toBe(false);
  expect(fetchMock.mock.calls[0][1].headers.get("x-pc-trial-browser")).toBe("1");
});
it("allows signed-in rendering while blocking external side effects", async () => {
  fetchMock.mockImplementation(async () => new Response("{}"));
  expect(await pcVercelProxy(req("/home"))).toBeNull();
  expect((await pcVercelProxy(req("/api/sheets/push-record", { method: "POST", headers: { origin } })))?.status).toBe(403);
});
