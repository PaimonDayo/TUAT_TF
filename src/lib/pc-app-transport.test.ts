import { describe, expect, it, vi } from "vitest";
import { createPcAppDataFetch } from "./pc-app-transport";
import { pcServerHeaders } from "./supabase/cloud-auth";

const cloud = { url: "https://issuer.supabase.co", anonKey: "synthetic-cloud-anon" };
const base = "https://pc-app.example.test/api/pc-supabase";
const member = "Bearer synthetic-member-jwt";

describe("PC app Auth/data split", () => {
  it("keeps login, refresh and logout on cloud without substituting local keys", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const transport = createPcAppDataFetch(fetcher, cloud, base, pcServerHeaders(cloud, "synthetic-local-anon"));
    for (const path of ["/auth/v1/user", "/auth/v1/token?grant_type=refresh_token", "/auth/v1/logout"]) {
      const request = new Request(`${cloud.url}${path}`, { method: path.includes("user") ? "GET" : "POST",
        headers: { apikey: cloud.anonKey, authorization: member } });
      await transport(request);
      expect(fetcher.mock.calls.at(-1)?.[0]).toBe(request);
    }
  });
  it("retains member identity, queries, method and body on the single data destination", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const transport = createPcAppDataFetch(fetcher, cloud, base, pcServerHeaders(cloud, "synthetic-local-anon"));
    await transport(new Request(`${cloud.url}/rest/v1/tweets?id=eq.synthetic&select=id`, { method: "PATCH",
      headers: { authorization: member, apikey: cloud.anonKey, prefer: "return=representation", "content-type": "application/json" },
      body: '{"body":"synthetic"}' }));
    const sent = fetcher.mock.calls[0][0] as Request;
    expect(sent.url).toBe(`${base}/rest/v1/tweets?id=eq.synthetic&select=id`);
    expect(sent.method).toBe("PATCH"); expect(await sent.text()).toBe('{"body":"synthetic"}');
    expect(sent.headers.get("authorization")).toBe(member); expect(sent.headers.get("apikey")).toBe("synthetic-local-anon");
    expect(sent.headers.get("prefer")).toBe("return=representation");
  });
  it("returns unavailable data once without a cloud replay or remembered cloud route", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("unavailable", { status: 503, headers: { "x-tuat-backend": "cloud" } }));
    const transport = createPcAppDataFetch(fetcher, cloud, base);
    for (const method of ["GET", "POST"]) {
      const response = await transport(`${cloud.url}/rest/v1/tweets`, { method });
      expect(response.status).toBe(503);
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url] of fetcher.mock.calls) expect(url).toBe(`${base}/rest/v1/tweets`);
    fetcher.mockRejectedValueOnce(new Error("uncertain response"));
    await expect(transport(`${cloud.url}/rest/v1/tweets`, { method: "POST" })).rejects.toThrow("uncertain response");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not rewrite lookalike issuer origins or non-data requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const transport = createPcAppDataFetch(fetcher, cloud, base);
    const unrelated = `${cloud.url}.attacker.test/rest/v1/tweets`;
    await transport(unrelated); expect(fetcher.mock.calls[0][0]).toBe(unrelated);
  });
});
