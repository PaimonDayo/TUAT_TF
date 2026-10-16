import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseMemberCsv,
  parsePublicSheetDate,
  parseSheetMetadataHtml,
  sheetContentSignature,
  fetchPublicSheetText,
  fetchPublicMemberSnapshot,
} from "./sheet-public-csv";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("bounded public sheet bodies", () => {
  it("keeps the deadline active after headers, even if a body ignores abort", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    vi.stubGlobal("fetch", fetchMock);
    const read = fetchPublicMemberSnapshot("B1 synthetic", { timeoutMs: 50, spreadsheetId: "synthetic", members: [{ name: "B1 synthetic", gid: "1" }] });
    const rejected = expect(read).rejects.toThrow("タイムアウト");
    await vi.advanceTimersByTimeAsync(51); await rejected;
    expect(cancelled).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", signal: expect.any(AbortSignal) });
  });
  it("refuses declared and streamed oversized bodies without trusting Content-Length", async () => {
    for (const headers of [{ "content-length": "5" }, { "content-length": "1" }, {}] as Record<string, string>[]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("12345", { headers })));
      await expect(fetchPublicSheetText("https://docs.google.com/synthetic", 100, 4, { cache: "no-store" })).rejects.toThrow("容量");
    }
  });
  it("decodes split UTF-8 and preserves explicit Next cache settings", async () => {
    const bytes = new TextEncoder().encode("日付,感想");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 1)); c.enqueue(bytes.slice(1)); c.close(); } })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchPublicSheetText("https://docs.google.com/synthetic", 100, 100, { next: { revalidate: 60 } })).text).toBe("日付,感想");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ next: { revalidate: 60 } });
  });
});

describe("sheetContentSignature", () => {
  it("is stable for identical CSV and changes with the body", () => {
    expect(sheetContentSignature("a,b\n1,2")).toBe(sheetContentSignature("a,b\n1,2"));
    expect(sheetContentSignature("a,b\n1,2")).not.toBe(sheetContentSignature("a,b\n1,3"));
  });
});

describe("parseSheetMetadataHtml", () => {
  it("extracts only member sheets and decodes escaped names", () => {
    const html = `
      items.push({name:"B2\\u99d2\\u4e95",gid:"123"});
      items.push({name:"予定",gid:"456"});
      items.push({name:"M1 山田",gid:"789"});
    `;
    expect(parseSheetMetadataHtml(html)).toEqual([
      { name: "B2駒井", gid: "123" },
      { name: "M1 山田", gid: "789" },
    ]);
  });
});

describe("parsePublicSheetDate", () => {
  it("keeps explicit years and supplies the current sheet year for M/D", () => {
    expect(parsePublicSheetDate("7/22", 2026)).toBe("2026-07-22");
    expect(parsePublicSheetDate("2025/12/31", 2026)).toBe("2025-12-31");
    expect(parsePublicSheetDate("2026-01-02", 2025)).toBe("2026-01-02");
  });

  it("rejects impossible or unrelated dates", () => {
    expect(parsePublicSheetDate("2/30", 2026)).toBeNull();
    expect(parsePublicSheetDate("合計", 2026)).toBeNull();
  });
});

describe("parseMemberCsv", () => {
  it("preserves record cells and never imports blank-header reply columns", () => {
    const csv = [
      "タイトル,,,,",
      "日付,感想,,,状態",
      '7/22,"改行を含む\\n感想",スプシ返信,追加返信,良好',
      "2/30,無効な日付,読まない,,",
    ].join("\n");
    const member = parseMemberCsv({ name: "B2駒井", gid: "123" }, csv, 2026);

    expect(member.header).toEqual(["日付", "感想", "状態"]);
    expect(member.records).toHaveLength(1);
    expect(member.records[0]).toMatchObject({
      date: "2026-07-22",
      cells: { 日付: "7/22", 感想: "改行を含む\\n感想", 状態: "良好" },
    });
    expect(member.records[0]).not.toHaveProperty("replies");
  });

  it("fails instead of treating a sheet without a date header as empty", () => {
    expect(() => parseMemberCsv({ name: "B2駒井", gid: "123" }, "名前,値\nA,1", 2026)).toThrow(
      "見出し行（日付）が見つかりません",
    );
  });
});
