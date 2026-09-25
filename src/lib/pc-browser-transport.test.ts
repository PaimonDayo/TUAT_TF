import { expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createPcBrowserTransport } from "./pc-browser-transport";
import { createCoalescedFetch } from "./coalesced-fetch";

const app = "https://app.example.test";
const relay = "https://relay.example.test";
function sdk(fetcher: typeof fetch) {
  return createClient(`${app}/api/pc-supabase`, "synthetic-anon", {
    accessToken: async () => "synthetic-member",
    global: { fetch: createCoalescedFetch(createPcBrowserTransport(fetcher, app, relay)) },
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
  const fetcher = createPcBrowserTransport(upstream, app, relay);
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
