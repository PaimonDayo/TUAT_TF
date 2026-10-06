import { afterEach, describe, expect, it, vi } from "vitest";
import { gasPost } from "./gas-client";

const endpoint = "https://script.google.com/macros/s/synthetic-deployment/exec";
const receipt = "https://script.googleusercontent.com/macros/echo?user_content_key=synthetic-receipt";
const redirect = () => new Response(null, { status: 302, headers: { location: receipt } });
function setup() {
  vi.stubEnv("SHEET_SYNC_GAS_URL", endpoint);
  vi.stubEnv("SHEET_SYNC_SECRET", "synthetic-secret");
  const request = vi.fn(); vi.stubGlobal("fetch", request); return request;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("GAS write receipts", () => {
  it("recovers a transient receipt 404 without sending the write twice", async () => {
    const request = setup().mockResolvedValueOnce(redirect())
      .mockResolvedValueOnce(new Response("unavailable", { status: 404 }))
      .mockResolvedValueOnce(new Response('{"success":true,"action":"updated"}'));
    expect(await gasPost({ action: "writeCells", cells: { synthetic: "saved" } })).toEqual({ success: true, action: "updated" });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "manual", cache: "no-store" });
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ secret: "synthetic-secret" });
    for (const call of request.mock.calls.slice(1)) {
      expect(call[0]).toBe(receipt);
      expect(call[1]).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
      expect(call[1].body).toBeUndefined(); expect(call[1].headers).toBeUndefined();
    }
  });
  it("bounds network/5xx receipt retries and preserves an unknown write result", async () => {
    const request = setup().mockResolvedValueOnce(redirect()).mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("unavailable", { status: 502 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(gasPost({ action: "writeReply", text: "synthetic" })).rejects.toThrow("HTTP 503");
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls.filter((call) => call[1].method === "POST")).toHaveLength(1);
  });
  it("does not retry POST required or any other explicit application error", async () => {
    const request = setup().mockResolvedValueOnce(redirect())
      .mockResolvedValueOnce(new Response('{"error":"POST required"}'));
    await expect(gasPost({ action: "writeCells" })).rejects.toThrow("POST required");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("reads a lost receipt body again without repeating the original write", async () => {
    const broken = new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("connection lost")); } }));
    const request = setup().mockResolvedValueOnce(redirect()).mockResolvedValueOnce(broken)
      .mockResolvedValueOnce(new Response('{"success":true}'));
    expect(await gasPost({ action: "writeCells" })).toEqual({ success: true });
    expect(request.mock.calls.map((call) => call[1].method)).toEqual(["POST", "GET", "GET"]);
  });
  it("does not turn a redirect back to an execution endpoint into another write", async () => {
    const request = setup().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: endpoint } }));
    await expect(gasPost({ action: "writeCells" })).rejects.toThrow("応答先を確認できません");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not retry an initial POST failure or forward a payload to another host", async () => {
    const request = setup().mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(gasPost({ action: "writeCells" })).rejects.toThrow("fetch failed");
    expect(request).toHaveBeenCalledTimes(1);
    request.mockReset().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://example.test/private" } }));
    await expect(gasPost({ action: "writeCells" })).rejects.toThrow("応答先を確認できません");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
