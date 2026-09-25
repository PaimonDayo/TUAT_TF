import { describe, expect, it } from "vitest";
import { clearCellsFor, sheetRecordsWithoutPendingPushes, sheetRowHasContent, type FieldMap } from "./sheet-sync";
import type { RawMember } from "./sheet-public-csv";

const map = {
  builtin: new Map([
    ["dist_low", { header: "低強度", column: 0, numeric: true }],
    ["memo", { header: "感想", column: 1, numeric: false }],
  ]),
  custom: new Map([["other", { header: "その他", column: 2, type: "text" }]]),
} as FieldMap;

function member(records: RawMember["records"]): RawMember {
  return { name: "B1 テスト", header: ["低強度", "感想", "その他"], records };
}

describe("clearCellsFor", () => {
  it("sends an empty value for every linked column so the day's row is emptied", () => {
    expect(clearCellsFor(map, "2026-09-20")).toEqual({ 低強度: "", 感想: "", その他: "" });
  });
});

describe("sheetRowHasContent", () => {
  it("is true only when the date's row still has a linked value", () => {
    const sheet = member([
      { date: "2026-09-20", cells: { 低強度: "5", 感想: "", その他: "" }, values: ["5", "", ""] },
      { date: "2026-09-21", cells: { 低強度: "", 感想: "", その他: "" }, values: ["", "", ""] },
    ]);
    expect(sheetRowHasContent(map, sheet, "2026-09-20")).toBe(true);
    // もう空なら書き込まない
    expect(sheetRowHasContent(map, sheet, "2026-09-21")).toBe(false);
    // 行が無い日に書き込むとGASが新しい行を作ってしまうので書き込まない
    expect(sheetRowHasContent(map, sheet, "2026-09-22")).toBe(false);
  });
});

describe("dates excluded from import", () => {
  it("skips a deleted day so the sheet cannot bring the record back before it is emptied", () => {
    const records = [
      { date: "2026-09-20", cells: { 感想: "消したはずの記録" } },
      { date: "2026-09-21", cells: { 感想: "残す記録" } },
    ];
    expect(sheetRecordsWithoutPendingPushes(records, new Set(["2026-09-20"])).map((r) => r.date)).toEqual(["2026-09-21"]);
  });
});
