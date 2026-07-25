import { describe, expect, it } from "vitest";
import { displayedDistance, unclassifiedDistance } from "./record-distance";
import {
  buildSheetRecordFields,
  defaultSelectedSheetColumns,
  memoHeaderCandidates,
  relevantSheetHeaderSignature,
} from "./sheet-field-config";

const middleColumns = [
  { index: 0, label: "日付" },
  { index: 1, label: "曜日" },
  { index: 2, label: "低強度" },
  { index: 3, label: "中強度" },
  { index: 4, label: "高強度" },
  { index: 5, label: "解糖系" },
  { index: 6, label: "実際の距離" },
  { index: 7, label: "流し" },
  { index: 8, label: "結果" },
  { index: 9, label: "補強" },
  { index: 10, label: "状態" },
  { index: 11, label: "感想" },
  { index: 12, label: "感想（大会）" },
  { index: 13, label: "睡眠時間" },
  { index: 14, label: "週合計" },
  { index: 15, label: "低強度 週合計" },
];

const shortColumns = [
  { index: 0, label: "日付" },
  { index: 1, label: "メニュー" },
  { index: 2, label: "目的・意識すること" },
  { index: 3, label: "考えたこと" },
  { index: 4, label: "コメント" },
  { index: 5, label: "睡眠時間" },
];

describe("sheet field configuration", () => {
  it("recognizes only the leftmost exact 感想 header", () => {
    expect(memoHeaderCandidates(middleColumns).map((column) => column.index)).toEqual([11]);
    expect(memoHeaderCandidates(middleColumns.filter((column) => column.index !== 11))).toEqual([]);
  });

  it("selects exact 感想 by default for middle-long and the four short defaults", () => {
    expect(defaultSelectedSheetColumns(middleColumns, true, 11)).toEqual([11]);
    expect(defaultSelectedSheetColumns(shortColumns, false, null)).toEqual([1, 2, 3, 4]);
  });

  it("keeps detected middle-long standard fields fixed and preserves sheet order", () => {
    const fields = buildSheetRecordFields({
      columns: middleColumns,
      selectedColumns: [11, 13],
      timelineColumns: [11],
      types: { 11: "text", 13: "number" },
      isMiddleLong: true,
      memoColumn: 11,
    });
    expect(fields.map((field) => field.sourceColumn)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 11, 13]);
    expect(fields.find((field) => field.key === "result_text")?.showInTimeline).toBe(true);
    expect(fields.find((field) => field.key === "memo")?.showInTimeline).toBe(true);
    expect(fields.find((field) => field.sourceColumn === 13)?.showInTimeline).toBe(false);
  });

  it("omits date, weekday, computed weekly totals and missing default slots", () => {
    const fields = buildSheetRecordFields({
      columns: [{ index: 0, label: "日付" }, { index: 1, label: "曜日" }, { index: 2, label: "週合計" }, { index: 3, label: "低強度 週合計" }, { index: 4, label: "自由記述" }],
      selectedColumns: [],
      timelineColumns: [],
      types: {},
      isMiddleLong: true,
      memoColumn: null,
    });
    expect(fields).toEqual([]);
  });

  it("ignores unused header renames but detects active header renames", () => {
    const fields = buildSheetRecordFields({
      columns: middleColumns,
      selectedColumns: [11],
      timelineColumns: [11],
      types: { 11: "text" },
      isMiddleLong: true,
      memoColumn: 11,
    });
    const initial = relevantSheetHeaderSignature(middleColumns, fields, true);
    const unusedRenamed = middleColumns.map((column) => column.index === 13 ? { ...column, label: "睡眠" } : column);
    const activeRenamed = middleColumns.map((column) => column.index === 11 ? { ...column, label: "振り返り" } : column);
    expect(relevantSheetHeaderSignature(unusedRenamed, fields, true)).toBe(initial);
    expect(relevantSheetHeaderSignature(activeRenamed, fields, true)).not.toBe(initial);
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