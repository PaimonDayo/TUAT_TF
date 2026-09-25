import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createPcBrowserTransport, RELAY_BYPASS_MS } from "./pc-browser-transport";
import { createCoalescedFetch } from "./coalesced-fetch";

const app = "https://app.example.test";
const relay = "https://relay.example.test";
function sdk(fetcher: typeof fetch) {
  return createClient(`${app}/api/pc-supabase`, "synthetic-anon", {
    accessToken: async () => "synthetic-member",
    global: { fetch: createCoalescedFetch(createPcBrowserTransport(fetcher, app, relay, { state: { bypassUntil: 0 } })) },
  });
}
it("coalesces real Supabase SDK selects and HEAD counts and routes them off Vercel", async () => {
  const upstream = vi.fn(async (_input, init) => new Response(init?.method === "HEAD" ? null : '[{"id":1}]', { headers: { "content-type": "application/json", "content-range": "0-0/1" } }));
  const client = sdk(upstream);
  const results = await Promise.all(Array.from({ length: 10 }, () => client.from("records").select("id")));
  expect(results.every(r => r.data?.[0].id === 1)).toBe(true);
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(upstream.mock.calls[0][0]).toBe(`${relay}/rest/v1/records?select=id`);
  expect(new Headers(upstream.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer synthetic-member");
  const counts = await Promise.all(Array.from({ length: 10 }, () => client.from("records").select("id", { head: true, count: "exact" })));
  expect(counts.every(r => r.count === 1)).toBe(true);
  expect(upstream).toHaveBeenCalledTimes(2);
});
it("real SDK writes are neither merged nor replayed on transport failure", async () => {
  const upstream = vi.fn(async () => { throw new Error("connection lost after commit"); });
  const client = sdk(upstream);
  await Promise.all([client.from("records").insert({ id: 1 }), client.from("records").insert({ id: 2 }), client.rpc("save_record", { id: 3 }),
    client.from("records").update({ value: 1 }).eq("id", 1), client.from("records").delete().eq("id", 2)]);
  expect(upstream).toHaveBeenCalledTimes(5);
});
it("leaves Auth, OAuth, logout and unrelated requests on their original transport", async () => {
  const upstream = vi.fn<typeof fetch>(async () => new Response("{}"));
  const fetcher = createPcBrowserTransport(upstream, app, relay, { state: { bypassUntil: 0 } });
  for (const path of ["token?grant_type=refresh_token", "user", "logout", "authorize?provider=google", "callback"]) {
    const url = `${app}/api/pc-supabase/auth/v1/${path}`;
    await fetcher(url);
    expect(upstream.mock.calls.at(-1)?.[0]).toBe(url);
  }
  await fetcher(`${app}/api/pc-supabase/rest/v1/records`, { method: "POST", body: "{}" });
  expect(upstream.mock.calls.at(-1)?.[1]).toMatchObject({ credentials: "omit", redirect: "error", method: "POST", body: "{}" });
  expect(createPcBrowserTransport(upstream, app)).toBe(upstream);
  expect(() => createPcBrowserTransport(upstream, app, "http://unsafe.test")).toThrow();
});

describe("relay fallback", () => {
  const restPath = `${app}/api/pc-supabase/rest/v1/records?select=id`;
  function setup(relayResponse: () => Promise<Response>) {
    let clock = 1_000;
    const state = { bypassUntil: 0 };
    const upstream = vi.fn<typeof fetch>(async (input) =>
      String(input).startsWith(relay) ? relayResponse() : new Response("[]", { status: 200 }));
    const fetcher = createPcBrowserTransport(upstream, app, relay, { now: () => clock, state });
    return { upstream, fetcher, state, advance: (ms: number) => { clock += ms; } };
  }

  it("re-reads through Vercel when the relay is blocked (limit shows up as a network error)", async () => {
    const { upstream, fetcher, state } = setup(async () => { throw new TypeError("Failed to fetch"); });
    const response = await fetcher(restPath);
    expect(response.status).toBe(200);
    expect(upstream.mock.calls.map((c) => String(c[0]))).toEqual([`${relay}/rest/v1/records?select=id`, restPath]);
    expect(state.bypassUntil).toBe(1_000 + RELAY_BYPASS_MS);
  });

  it("re-reads on 429/503 and then sends everything, including writes, through Vercel for a while", async () => {
    const { upstream, fetcher, advance } = setup(async () => new Response("limit", { status: 429 }));
    expect((await fetcher(restPath)).status).toBe(200);
    await fetcher(`${app}/api/pc-supabase/rest/v1/records`, { method: "POST", body: "{}" });
    expect(String(upstream.mock.calls.at(-1)?.[0])).toBe(`${app}/api/pc-supabase/rest/v1/records`);
    // 10分たったら中継をもう一度試す（まだ使えなければ、また元の経路で取り直す）。
    advance(RELAY_BYPASS_MS + 1);
    await fetcher(restPath);
    expect(upstream.mock.calls.slice(-2).map((c) => String(c[0]))).toEqual([`${relay}/rest/v1/records?select=id`, restPath]);
  });

  it("never replays the failed write itself", async () => {
    const { upstream, fetcher, state } = setup(async () => { throw new TypeError("connection lost after commit"); });
    await expect(fetcher(`${app}/api/pc-supabase/rest/v1/records`, { method: "PATCH", body: "{}" })).rejects.toThrow();
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(state.bypassUntil).toBeGreaterThan(0);
  });

  it("does not fall back when the caller aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { upstream, fetcher, state } = setup(async () => { throw new DOMException("aborted", "AbortError"); });
    await expect(fetcher(restPath, { signal: controller.signal })).rejects.toThrow();
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(state.bypassUntil).toBe(0);
  });

  it("passes ordinary errors from the database (401/403/409) through without falling back", async () => {
    const { upstream, fetcher, state } = setup(async () => new Response("denied", { status: 403 }));
    expect((await fetcher(restPath)).status).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(state.bypassUntil).toBe(0);
  });
});
