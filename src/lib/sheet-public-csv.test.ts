import { describe, expect, it } from "vitest";
import {
  parseMemberCsv,
  parsePublicSheetDate,
  parseSheetMetadataHtml,
} from "./sheet-public-csv";

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
  it("preserves displayed cells and imports blank-header reply columns", () => {
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
      replies: [
        { replyIndex: 2, content: "スプシ返信", source: "sheet" },
        { replyIndex: 3, content: "追加返信", source: "sheet" },
      ],
    });
  });

  it("fails instead of treating a sheet without a date header as empty", () => {
    expect(() => parseMemberCsv({ name: "B2駒井", gid: "123" }, "名前,値\nA,1", 2026)).toThrow(
      "見出し行（日付）が見つかりません",
    );
  });
});
