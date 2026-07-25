import { describe, expect, it } from "vitest";
import { displayedDistance, unclassifiedDistance } from "./record-distance";
import { buildSheetRecordFields, memoHeaderCandidates, sheetHeaderSignature } from "./sheet-field-config";

const columns = [
  { index: 0, label: "日付" },
  { index: 1, label: "低強度" },
  { index: 2, label: "中強度" },
  { index: 3, label: "高強度" },
  { index: 4, label: "解糖系" },
  { index: 5, label: "実際の距離" },
  { index: 6, label: "状態" },
  { index: 7, label: "感想" },
  { index: 8, label: "睡眠時間" },
];

describe("sheet field configuration", () => {
  it("prioritizes exact 感想 but exposes every ambiguous memo candidate", () => {
    expect(memoHeaderCandidates(columns).map((column) => column.index)).toEqual([7, 6]);
  });

  it("keeps intensity and actual distance fixed while adding selected form columns", () => {
    const fields = buildSheetRecordFields({
      columns,
      selectedColumns: [7, 8],
      types: { 7: "text", 8: "number" },
      isMiddleLong: true,
      memoColumn: 7,
    });
    expect(fields.find((field) => field.key === "dist_low")?.sourceColumn).toBe(1);
    expect(fields.find((field) => field.key === "dist_actual")?.sourceColumn).toBe(5);
    expect(fields.find((field) => field.key === "memo")?.sourceColumn).toBe(7);
    expect(fields.find((field) => field.sourceColumn === 8)?.type).toBe("number");
  });

  it("detects header renames", () => {
    expect(sheetHeaderSignature(columns)).not.toBe(
      sheetHeaderSignature(columns.map((column) => column.index === 8 ? { ...column, label: "睡眠" } : column)),
    );
  });
});

describe("actual distance fallback", () => {
  it("uses intensity sum when any intensity exists", () => {
    const record = { dist_low: 5, dist_mid: 2, dist_high: 0, dist_speed: 0, dist_actual: 12 };
    expect(displayedDistance(record)).toBe(7);
    expect(unclassifiedDistance(record)).toBe(0);
  });

  it("uses actual distance only when every intensity is zero", () => {
    const record = { dist_low: 0, dist_mid: 0, dist_high: 0, dist_speed: 0, dist_actual: 12 };
    expect(displayedDistance(record)).toBe(12);
    expect(unclassifiedDistance(record)).toBe(12);
  });
});
