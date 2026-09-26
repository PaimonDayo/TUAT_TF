import { describe, expect, it, vi } from "vitest";
import { pcServerHeaders, routeDataToPc } from "./cloud-auth";

const cloud = { url: "https://cloud.example.supabase.co", anonKey: "cloud-anon" };
const pcBase = "https://app.example.test/api/pc-supabase";

function setup(rewrite?: (headers: Headers) => void) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response("{}"));
  return { fetcher, routed: routeDataToPc(fetcher, cloud, pcBase, rewrite) };
}

describe("routeDataToPc", () => {
  it("keeps login on the cloud", async () => {
    const { fetcher, routed } = setup();
    for (const path of ["/auth/v1/token?grant_type=refresh_token", "/auth/v1/user", "/auth/v1/logout"]) {
      await routed(`${cloud.url}${path}`);
      expect(String(fetcher.mock.calls.at(-1)?.[0])).toBe(`${cloud.url}${path}`);
    }
  });

  it("sends data APIs to the PC with the query intact", async () => {
    const { fetcher, routed } = setup();
    await routed(`${cloud.url}/rest/v1/practice_records?select=id&limit=1`, { method: "GET" });
    expect(fetcher.mock.calls[0][0]).toBe(`${pcBase}/rest/v1/practice_records?select=id&limit=1`);
    await routed(`${cloud.url}/storage/v1/object/x`);
    expect(fetcher.mock.calls[1][0]).toBe(`${pcBase}/storage/v1/object/x`);
  });

  it("leaves unrelated URLs alone", async () => {
    const { fetcher, routed } = setup();
    await routed("https://elsewhere.example/rest/v1/x");
    expect(fetcher.mock.calls[0][0]).toBe("https://elsewhere.example/rest/v1/x");
  });

  it("swaps the cloud keys for the PC keys on server-side data calls, but keeps a member token", async () => {
    const { fetcher, routed } = setup(pcServerHeaders(cloud, "pc-anon"));
    await routed(`${cloud.url}/rest/v1/x`, { headers: { apikey: "cloud-anon", Authorization: "Bearer cloud-anon" } });
    let headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get("apikey")).toBe("pc-anon");
    expect(headers.get("authorization")).toBe("Bearer pc-anon");
    await routed(`${cloud.url}/rest/v1/x`, { headers: { apikey: "cloud-anon", Authorization: "Bearer member-token" } });
    headers = new Headers(fetcher.mock.calls[1][1]?.headers);
    expect(headers.get("apikey")).toBe("pc-anon");
    expect(headers.get("authorization")).toBe("Bearer member-token");
  });
});
