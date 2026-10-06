import { afterEach, describe, expect, it, vi } from "vitest";
import { gasPost, readGasJson, fetchAllRaw } from "./gas-client";
import { sheetContentSignature } from "@/lib/sheet-public-csv";
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

describe("per-member CSV failures", () => {
  const csv = "日付,感想\n2026/10/5,synthetic contents";
  function stubMemberCsvs(first: Response, second: Response) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/htmlview")) return new Response('items.push({name:"B1 synthetic",gid:"1"});items.push({name:"B2 synthetic",gid:"2"});');
      return url.includes("gid=1") ? first : second;
    }));
  }

  it("retains a successful unchanged member when another member's CSV fails", async () => {
    stubMemberCsvs(new Response(csv, { headers: { "content-type": "text/csv" } }), new Response("unavailable", { status: 503 }));
    const result = await fetchAllRaw([
      { name: "B1 synthetic", previousSignature: sheetContentSignature(csv), forceParse: false },
      { name: "B2 synthetic", previousSignature: null, forceParse: false },
    ], "synthetic-unchanged-partial-failure");
    expect(result.members).toEqual([]);
    expect(result.unchangedMembers).toEqual(["B1 synthetic"]);
    expect(result.signatures.get("B1 synthetic")).toBe(sheetContentSignature(csv));
    expect(result.signatures.has("B2 synthetic")).toBe(false);
    expect(result.failedMembers).toEqual([{ member: "B2 synthetic", reason: "CSVを取得できませんでした (503)" }]);
  });

  it("returns each actual reason when every member CSV fails", async () => {
    stubMemberCsvs(new Response("unavailable", { status: 503 }), new Response("unavailable", { status: 502 }));
    const result = await fetchAllRaw([
      { name: "B1 synthetic", previousSignature: null, forceParse: false },
      { name: "B2 synthetic", previousSignature: null, forceParse: false },
    ], "synthetic-total-csv-failure");
    expect(result.members).toEqual([]);
    expect(result.unchangedMembers).toEqual([]);
    expect(result.signatures.size).toBe(0);
    expect(result.failedMembers).toEqual([
      { member: "B1 synthetic", reason: "CSVを取得できませんでした (503)" },
      { member: "B2 synthetic", reason: "CSVを取得できませんでした (502)" },
    ]);
  });
});
