import { describe, expect, it } from "vitest";
import { appToCellsFull, computeMemberPull, resolveFieldMap, type DbRecord, type FieldMap } from "./sheet-sync";

const fieldMap = {
  builtin: new Map([["memo", { header: "memo", column: 0, numeric: false }]]),
  custom: new Map(),
} as Parameters<typeof computeMemberPull>[1];

function dbRecord(date: string, memo: string): DbRecord {
  return {
    id: `record-${date}`, user_id: "user-1", recorded_date: date,
    dist_low: 0, dist_mid: 0, dist_high: 0, dist_speed: 0, strides: 0,
    dist_actual: 0,
    strength_text: null, result_text: null, memo, menu_text: null, focus_text: null,
    custom: {}, updated_at: null, synced_at: null,
  };
}

describe("computeMemberPull", () => {
  const sheetRecords = [
    { date: "2026-07-23", cells: { memo: "sheet value" } },
    { date: "2026-07-24", cells: { memo: "CSV-only post" } },
  ];
  const existing = new Map<string, DbRecord[]>([["2026-07-23", [dbRecord("2026-07-23", "app value")]]]);

  it("preserves an existing app record and imports only a missing CSV date", () => {
    const result = computeMemberPull("user-1", fieldMap, sheetRecords, existing, () => true, "2026-07-24T15:00:00.000Z", "preserve");
    expect(result.updates).toEqual([]);
    expect(result.inserts).toHaveLength(1);
    expect(result.inserts[0]).toMatchObject({ user_id: "user-1", recorded_date: "2026-07-24", from_sheet: true, memo: "CSV-only post" });
  });

  it("keeps sheet-main merge behavior for an existing date", () => {
    const result = computeMemberPull("user-1", fieldMap, sheetRecords, existing, () => true, "2026-07-24T15:00:00.000Z", "merge_nonempty");
    expect(result.updates).toEqual([{ id: "record-2026-07-23", patch: { memo: "sheet value", synced_at: "2026-07-24T15:00:00.000Z" } }]);
    expect(result.inserts).toHaveLength(1);
  });

  it("keeps the existing value for non-system users when the sheet cell is blank", () => {
    const blankSheet = [{ date: "2026-07-23", cells: { memo: "" }, values: [""] }];
    const result = computeMemberPull(
      "user-1",
      fieldMap,
      blankSheet,
      existing,
      () => true,
      "2026-07-24T15:00:00.000Z",
      "merge_nonempty",
    );
    expect(result.updates).toEqual([]);
  });

  it("clears a mapped DB value when the sheet-authoritative cell is blank", () => {
    const blankSheet = [{ date: "2026-07-23", cells: { memo: "" }, values: [""] }];
    const result = computeMemberPull(
      "user-1",
      fieldMap,
      blankSheet,
      existing,
      () => true,
      "2026-07-24T15:00:00.000Z",
      "replace_mapped",
    );
    expect(result.updates).toEqual([
      { id: "record-2026-07-23", patch: { memo: null, synced_at: "2026-07-24T15:00:00.000Z" } },
    ]);
  });
  it("does not create a record from an empty numeric custom cell", () => {
    const numericCustomMap = {
      builtin: new Map(),
      custom: new Map([["sleep_hours", { header: "sleep", column: 0, type: "number" }]]),
    } as Parameters<typeof computeMemberPull>[1];
    const result = computeMemberPull(
      "user-1",
      numericCustomMap,
      [{ date: "2026-07-24", cells: { sleep: "" }, values: [""] }],
      new Map(),
      () => true,
      "2026-07-24T15:00:00.000Z",
      "replace_mapped",
    );
    expect(result.inserts).toEqual([]);
  });
});

describe("appToCellsFull", () => {
  it("sends empty mapped values so an edit can clear spreadsheet cells", () => {
    const map = {
      builtin: new Map([
        ["memo", { header: "感想", column: 0, numeric: false }],
        ["dist_low", { header: "低強度", column: 1, numeric: true }],
      ]),
      custom: new Map([
        ["sleep", { header: "睡眠", column: 2, type: "text" }],
      ]),
    } as FieldMap;
    const record = dbRecord("2026-07-26", "");
    record.custom = { sleep: null };

    expect(appToCellsFull(map, record)).toEqual({
      感想: "",
      低強度: 0,
      睡眠: "",
    });
  });
});

describe("resolveFieldMap", () => {
  it("does not let a builtin keyword fallback steal a configured custom column", () => {
    const map = resolveFieldMap(
      {
        header: ["\u65e5\u4ed8", "\u66dc\u65e5", "\u30e1\u30cb\u30e5\u30fc", "\u610f\u8b58\u30fb\u30a6\u30a8\u30a4\u30c8\u6570\u5024"],
        columns: [
          { index: 0, label: "\u65e5\u4ed8" },
          { index: 1, label: "\u66dc\u65e5" },
          { index: 2, label: "\u30e1\u30cb\u30e5\u30fc" },
          { index: 5, label: "\u610f\u8b58\u30fb\u30a6\u30a8\u30a4\u30c8\u6570\u5024" },
        ],
      },
      [
        {
          key: "menu_text",
          label: "\u30e1\u30cb\u30e5\u30fc",
          type: "text",
          sourceColumn: 2,
          sourceHeader: "\u30e1\u30cb\u30e5\u30fc",
        },
        {
          key: "sheet_5_custom",
          label: "\u610f\u8b58\u30fb\u30a6\u30a8\u30a4\u30c8\u6570\u5024",
          type: "text",
          sourceColumn: 5,
          sourceHeader: "\u610f\u8b58\u30fb\u30a6\u30a8\u30a4\u30c8\u6570\u5024",
        },
      ],
    );

    expect(map.builtin.has("focus_text")).toBe(false);
    expect(map.custom.get("sheet_5_custom")).toEqual({
      header: "\u610f\u8b58\u30fb\u30a6\u30a8\u30a4\u30c8\u6570\u5024",
      column: 5,
      type: "text",
    });
  });
});
