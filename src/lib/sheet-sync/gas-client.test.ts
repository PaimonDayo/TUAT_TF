import { afterEach, describe, expect, it, vi } from "vitest";
import { gasPost, readGasJson } from "./gas-client";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("GAS response validation", () => {
  it("reports HTTP and HTML without leaking the response body or diagnosing an unproven configuration issue", async () => {
    await expect(readGasJson(new Response("<html>private-token</html>", { status: 503 })))
      .rejects.toThrow("HTTP 503・HTML");
    try { await readGasJson(new Response("<html>private-token</html>")); } catch (error) {
      expect(String(error)).not.toContain("private-token");
      expect(String(error)).not.toContain("公開設定を確認");
    }
  });
  it("rejects unsuccessful HTTP responses even when they contain valid JSON", async () => {
    await expect(readGasJson(new Response('{"success":true}', { status: 500 }))).rejects.toThrow("HTTP 500");
  });
  it("rejects primitive JSON, retains explicit GAS errors, and accepts normal object responses", async () => {
    await expect(readGasJson(new Response("null"))).rejects.toThrow("応答形式");
    await expect(readGasJson(new Response('{"error":"unauthorized"}'))).rejects.toThrow("GASエラー: unauthorized");
    expect(await readGasJson(new Response('{"success":true}'))).toEqual({ success: true });
  });
  it("does not acknowledge a write whose success was omitted and does not blindly retry it", async () => {
    vi.stubEnv("SHEET_SYNC_GAS_URL", "https://example.test/sync");
    vi.stubEnv("SHEET_SYNC_SECRET", "test-only");
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal("fetch", fetch);
    await expect(gasPost({ action: "writeCells", cells: {} })).rejects.toThrow("書き込み完了");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
