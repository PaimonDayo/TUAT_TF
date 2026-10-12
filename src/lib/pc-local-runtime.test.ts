import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { getPcAppRuntime } from "./pc-app-runtime";
import { pcBackendFetch } from "./pc-backend";
import { sessionClientConfig } from "./supabase/server-client-options";
import { GET, POST } from "@/app/api/pc-supabase/[...path]/route";

const origin = "https://pc.example.test", base = `${origin}/api/pc-supabase`;
beforeEach(() => {
  for (const [name,value] of Object.entries({ PC_APP_RUNTIME: "true", NEXT_PUBLIC_PC_APP_RUNTIME: "true", PC_LOCAL_RUNTIME: "true", NEXT_PUBLIC_PC_LOCAL_RUNTIME: "true",
    PC_BACKEND_ENABLED: "true", NEXT_PUBLIC_PC_BACKEND: "true", APP_PUBLIC_ORIGIN: origin, NEXT_PUBLIC_SUPABASE_URL: base,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-local-anon", PC_LOCAL_AUTH_URL: "http://127.0.0.1:18001", PC_LOCAL_REST_URL: "http://127.0.0.1:18002",
    IMAGE_STORAGE_DRIVER: "local", R2_READ_ENABLED: "false", R2_WRITE_ENABLED: "false", NEXT_PUBLIC_CLOUD_AUTH_URL: "", NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY: "",
    NEXT_PUBLIC_CLOUD_AUTH_MODE: "", PC_BACKEND_INTERNAL_URL: "", NEXT_PUBLIC_PC_REST_RELAY_ORIGIN: "", VERCEL: "", VERCEL_ENV: "" })) vi.stubEnv(name,value);
  vi.stubEnv("PC_APP_SYNTHETIC_REVIEW","true");vi.stubEnv("NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW","true");vi.stubEnv("SHEET_SYNC_ENABLED","false");
  vi.stubEnv("LOCAL_IMAGE_STORAGE_ROOT",resolve("..","synthetic-images"));vi.stubEnv("LOCAL_IMAGE_SIGNING_KEY","synthetic-key-only".repeat(3));vi.stubEnv("LOCAL_IMAGE_MAX_STORAGE_BYTES","1000");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("rejects a privileged public key before local deployment startup", () => {
  vi.stubEnv("PC_APP_SYNTHETIC_REVIEW","false");vi.stubEnv("NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW","false");
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY",`${encode({alg:"HS256"})}.${encode({role:"service_role"})}.synthetic-signature`);
  expect(() => getPcAppRuntime()).toThrow("server-only");
});
it("selects a single local issuer and routes token refresh to private GoTrue without backup bypass for business writes", async () => {
  expect(getPcAppRuntime()?.cloud).toBeNull();
  expect(sessionClientConfig()).toMatchObject({ url: base, key: "synthetic-local-anon", options: { cookieOptions: { name: "sb-pc-backend-auth" } } });
  const dispatch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ refreshed: true })); vi.stubGlobal("fetch",dispatch);
  const response = await pcBackendFetch(`${base}/auth/v1/token?grant_type=refresh_token`, { method: "POST", body: '{"refresh_token":"synthetic"}' });
  expect(response.status).toBe(200); expect(dispatch.mock.calls[0][0]).toBe("http://127.0.0.1:18001/token?grant_type=refresh_token");
  const protectedSave = await pcBackendFetch(`${base}/rest/v1/profiles`, { method: "PATCH", body: "{}" });
  expect(protectedSave.status).toBe(503); expect(dispatch).toHaveBeenCalledOnce();
});
it("keeps local reads local and never retries a failed issuer against the cloud", async () => {
  const dispatch = vi.fn<typeof fetch>().mockResolvedValue(Response.json([])); vi.stubGlobal("fetch",dispatch);
  await pcBackendFetch(`${base}/rest/v1/profiles?select=id`);
  expect(dispatch.mock.calls[0][0]).toBe("http://127.0.0.1:18002/profiles?select=id");
  dispatch.mockClear(); dispatch.mockRejectedValue(new Error("Local issuer unavailable"));
  const response = await POST(new Request(`${base}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: '{"refresh_token":"synthetic"}' }));
  expect(response.status).toBe(503); expect(dispatch).toHaveBeenCalledOnce();
});
it("exposes public JWKS/Google exchanges while refusing admin keys/endpoints and foreign-origin exchange", async () => {
  const dispatch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ keys: [] })); vi.stubGlobal("fetch",dispatch);
  expect((await GET(new Request(`${base}/auth/v1/.well-known/jwks.json`))).status).toBe(200);
  expect((await GET(new Request(`${base}/auth/v1/admin/users`))).status).toBe(403);
  expect((await POST(new Request(`${base}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { origin: "https://attacker.example.test" } }))).status).toBe(403);
  expect((await POST(new Request(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { origin } }))).status).toBe(403);
  expect(dispatch).toHaveBeenCalledOnce();
});
it.each([{ NEXT_PUBLIC_CLOUD_AUTH_URL: "https://issuer.supabase.co" },{ R2_SECRET_ACCESS_KEY: "synthetic" },{ PC_LOCAL_AUTH_URL: "http://0.0.0.0:18001" },
  { PC_LOCAL_REST_URL: "http://127.0.0.1:18001" },{ NEXT_PUBLIC_PC_LOCAL_RUNTIME: "false" },{ R2_READ_ENABLED: "true" },
  { LOCAL_IMAGE_STORAGE_ROOT: resolve(process.cwd(), "..private/images") }])("rejects mixed or externally exposed deployment before any IO: %j", settings => {
  for (const [name,value] of Object.entries(settings)) vi.stubEnv(name,value);
  expect(() => getPcAppRuntime()).toThrow();
});
