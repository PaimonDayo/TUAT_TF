import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createCloudAuthFetch } from "./auth-fetch";

const subject = "00000000-0000-4000-8000-000000000001";
let keys: CryptoKeyPair, jwk: JsonWebKey, fixtureNumber = 0;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime("2026-10-11T01:00:00.000Z"); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function fixture(mode: "server" | "browser", adapted = true, expired = true) {
  const origin = `https://auth-rate-${++fixtureNumber}.example.invalid`, cookieName = `sb-rate-${fixtureNumber}`, kid = `test-rate-${fixtureNumber}`;
  async function token(exp: number, invalid = false) {
    const unsigned = `${encode({ alg: "ES256", typ: "JWT", kid })}.${encode({ sub: subject, email: "member@example.invalid", aud: "authenticated", role: "authenticated", exp })}`;
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(unsigned)));
    if (invalid) signature[0] ^= 1;
    return `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
  }
  const now = Math.floor(Date.now() / 1000), user = { id: subject, email: "member@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-11T00:00:00Z" };
  const session = { access_token: await token(expired ? now - 60 : now + 3600), refresh_token: "synthetic-rate-refresh", expires_at: expired ? now - 60 : now + 3600, expires_in: 3600, token_type: "bearer", user };
  const cookieWrites = vi.fn(), state = { status: 429, invalidSignature: false };
  const dispatch = vi.fn<typeof fetch>(async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe(origin);
    if (url.pathname.endsWith("/jwks.json")) return Response.json({ keys: [{ ...jwk, kid, alg: "ES256", use: "sig" }] });
    if (url.pathname === "/auth/v1/user") return Response.json({ message: "Synthetic user rate limit", code: "over_request_rate_limit" }, { status: 429 });
    expect(url.pathname).toBe("/auth/v1/token");
    if (state.status === 200) return Response.json({ ...session, access_token: await token(Math.floor(Date.now() / 1000) + 3600, state.invalidSignature), expires_at: Math.floor(Date.now() / 1000) + 3600 });
    return Response.json({ message: "Synthetic refresh failure", code: state.status === 429 ? "over_request_rate_limit" : "refresh_token_not_found" },
      { status: state.status, headers: { "retry-after": "60", "x-supabase-api-version": "2024-01-01" } });
  });
  const options = { cookieOptions: { name: cookieName }, global: { fetch: adapted ? createCloudAuthFetch(dispatch, origin) : dispatch },
    cookies: { getAll: () => [{ name: cookieName, value: `base64-${encode(session)}` }], setAll: cookieWrites }, auth: { autoRefreshToken: false } };
  const client = mode === "server" ? createServerClient(origin, "synthetic-anon", options) : createBrowserClient(origin, "synthetic-anon", { ...options, isSingleton: false });
  return { client, dispatch, cookieWrites, state };
}
async function settle<T>(promise: Promise<T>) { await vi.runAllTimersAsync(); return promise; }

it("reproduces installed SDK cookie removal for an expired refresh429 without the adapter", async () => {
  const { client, cookieWrites, dispatch } = await fixture("server", false);
  const result = await client.auth.getClaims();
  expect(result.error).toMatchObject({ status: 429 }); expect(result.data).toBeNull(); expect(dispatch).toHaveBeenCalledOnce();
  expect(cookieWrites.mock.calls.flatMap(([writes]) => writes).some(write => write.options.maxAge === 0)).toBe(true);
});
it.each(["server", "browser"] as const)("%s SDK preserves expired-refresh cookies and sends no repeated provider request during429 cooldown", async mode => {
  const { client, cookieWrites, dispatch, state } = await fixture(mode);
  const started = Date.now(), result = await settle(client.auth.getClaims());
  expect(result.error).toMatchObject({ name: "AuthRetryableFetchError", status: 503 }); expect(result.data).toBeNull();
  expect(Date.now() - started).toBeGreaterThanOrEqual(25_000); expect(Date.now() - started).toBeLessThan(30_000);
  expect(dispatch).toHaveBeenCalledOnce(); expect(cookieWrites).not.toHaveBeenCalled();
  // The SDK adds its own 60s failure cooldown after its ~25.4s retry window.
  vi.setSystemTime(started + 91_000); state.status = 200;
  const recovered = await client.auth.getClaims(); expect(recovered.data?.claims.sub).toBe(subject); expect(recovered.error).toBeNull();
  expect(dispatch.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(["/auth/v1/token", "/auth/v1/token", "/auth/v1/.well-known/jwks.json"]);
  expect(cookieWrites).toHaveBeenCalled();
});
it.each(["server", "browser"] as const)("%s SDK preserves valid cookies for/user429 and uses verified claims without/user", async mode => {
  const { client, cookieWrites, dispatch } = await fixture(mode, true, false);
  expect((await client.auth.getClaims()).data?.claims.sub).toBe(subject);
  expect((await client.auth.getClaims()).data?.claims.sub).toBe(subject);
  expect(dispatch).toHaveBeenCalledOnce();
  expect((await client.auth.getUser()).error).toMatchObject({ status: 429 });
  expect(cookieWrites).not.toHaveBeenCalled(); expect(dispatch).toHaveBeenCalledTimes(2);
});
it.each(["server", "browser"] as const)("%s SDK still clears an expired session after confirmed invalid grant", async mode => {
  const { client, cookieWrites, dispatch, state } = await fixture(mode); state.status = 400;
  expect((await client.auth.getClaims()).error).toMatchObject({ status: 400 }); expect(dispatch).toHaveBeenCalledOnce();
  expect(cookieWrites.mock.calls.flatMap(([writes]) => writes).some(write => write.options.maxAge === 0)).toBe(true);
});
it("does not accept a newly refreshed JWT with an invalid signature", async () => {
  const { client, state } = await fixture("server"); state.status = 200; state.invalidSignature = true;
  expect((await client.auth.getClaims()).data).toBeNull();
});
it("maps only confirmed cloud refresh429, preserves headers/body, and keeps clients independent", async () => {
  const origin = "https://auth-response.example.invalid", endpoint = `${origin}/auth/v1/token?grant_type=refresh_token`;
  const dispatch = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ message: "Synthetic refusal", code: "over_request_rate_limit" },
    { status: 429, headers: { "retry-after": "120", "x-supabase-api-version": "2024-01-01" } }));
  const first = createCloudAuthFetch(dispatch, origin), second = createCloudAuthFetch(dispatch, origin), init = { method: "POST", body: '{"refresh_token":"synthetic"}' };
  const response = await first(endpoint, init); expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("120");
  expect(response.headers.get("x-supabase-api-version")).toBe("2024-01-01"); expect(await response.json()).toMatchObject({ code: "over_request_rate_limit" });
  expect((await first(endpoint, init)).status).toBe(503); expect(dispatch).toHaveBeenCalledOnce();
  await second(endpoint, init); expect(dispatch).toHaveBeenCalledTimes(2);
  for (const url of [`${origin}/auth/v1/user`, `${origin}/rest/v1/tweets`, `${origin}/auth/v1/token?grant_type=password`, "https://other.example.invalid/auth/v1/token?grant_type=refresh_token"]) {
    expect((await first(url, init)).status).toBe(429);
  }
  expect(dispatch).toHaveBeenCalledTimes(6);
});
it("bounds a stalled confirmed429 body and suppresses another provider dispatch", async () => {
  const cancel = vi.fn(), origin = "https://auth-stall.example.invalid";
  const dispatch = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start() {}, cancel }),
    { status: 429, headers: { "retry-after": "60", "content-length": "900", "content-encoding": "gzip" } }));
  const fetcher = createCloudAuthFetch(dispatch, origin), init = { method: "POST", body: '{"refresh_token":"synthetic"}' };
  const promise = fetcher(`${origin}/auth/v1/token?grant_type=refresh_token`, init);
  await vi.advanceTimersByTimeAsync(3000);
  const response = await promise;
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "over_request_rate_limit" });
  expect(response.headers.get("retry-after")).toBe("60"); expect(response.headers.has("content-length")).toBe(false);
  expect(response.headers.has("content-encoding")).toBe(false); expect(cancel).toHaveBeenCalledOnce();
  await fetcher(`${origin}/auth/v1/token?grant_type=refresh_token`, init); expect(dispatch).toHaveBeenCalledOnce();
});
