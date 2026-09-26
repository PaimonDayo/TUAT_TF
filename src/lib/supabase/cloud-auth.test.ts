import { describe, expect, it, vi } from "vitest";
import { BACKEND_MODE_HEADER, CLOUD_DIRECT_MS, pcServerHeaders, routeDataToPc, withCloudFailover } from "./cloud-auth";

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

describe("withCloudFailover", () => {
  const data = `${cloud.url}/rest/v1/tweets?select=id`;
  function setup(pcResponse: () => Response) {
    let time = 1_000;
    const state = { until: 0 };
    const toPc = vi.fn<typeof fetch>(async () => pcResponse());
    const direct = vi.fn<typeof fetch>(async () => new Response("cloud"));
    const routed = withCloudFailover(toPc, direct, cloud, { now: () => time, state });
    return { toPc, direct, routed, advance: (ms: number) => { time += ms; } };
  }

  it("uses the PC while it answers normally", async () => {
    const { toPc, direct, routed } = setup(() => new Response("pc"));
    expect(await (await routed(data)).text()).toBe("pc");
    expect(toPc).toHaveBeenCalledTimes(1);
    expect(direct).not.toHaveBeenCalled();
  });

  it("resends an undelivered request to the cloud and stays there for a while", async () => {
    const { toPc, direct, routed, advance } = setup(() => new Response(null, { status: 503, headers: { [BACKEND_MODE_HEADER]: "cloud" } }));
    expect(await (await routed(data, { method: "POST", body: "{}" })).text()).toBe("cloud");
    await routed(data);
    expect(toPc).toHaveBeenCalledTimes(1);
    expect(direct).toHaveBeenCalledTimes(2);
    advance(CLOUD_DIRECT_MS + 1);
    await routed(data);
    expect(toPc).toHaveBeenCalledTimes(2);
  });

  it("keeps a cloud answer relayed by the app server without sending it twice", async () => {
    const { direct, routed } = setup(() => new Response("via-app", { headers: { [BACKEND_MODE_HEADER]: "cloud" } }));
    expect(await (await routed(data, { method: "POST", body: "{}" })).text()).toBe("via-app");
    expect(direct).not.toHaveBeenCalled();
  });

  it("does not resend a plain 503, which may have reached the PC", async () => {
    const { direct, routed } = setup(() => new Response(null, { status: 503 }));
    expect((await routed(data, { method: "POST", body: "{}" })).status).toBe(503);
    expect(direct).not.toHaveBeenCalled();
  });

  it("never moves login calls", async () => {
    const { toPc, direct, routed } = setup(() => new Response(null, { status: 503, headers: { [BACKEND_MODE_HEADER]: "cloud" } }));
    await routed(`${cloud.url}/auth/v1/user`);
    expect(toPc).toHaveBeenCalledTimes(1);
    expect(direct).not.toHaveBeenCalled();
  });
});
