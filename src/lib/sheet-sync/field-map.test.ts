import { describe, expect, it } from "vitest";
import { resolveFieldMap, sheetToAppValues } from "./field-map";

const member = { header: ["低強度", "低強度", "睡眠", "睡眠"], columns: [
  { index: 2, label: "低強度" }, { index: 5, label: "低強度" },
  { index: 7, label: "睡眠" }, { index: 9, label: "睡眠" },
] };

describe("physical sheet column selection", () => {
  it("prefers an explicitly matched physical column over the first equal header", () => {
    const map = resolveFieldMap(member, [
      { key: "dist_low", label: "低強度", type: "number", sourceHeader: "低強度", sourceColumn: 5 },
      { key: "sleep", label: "睡眠", type: "number", sourceHeader: "睡眠", sourceColumn: 9 },
    ]);
    expect(map.builtin.get("dist_low")?.column).toBe(5);
    expect(map.custom.get("sleep")?.column).toBe(9);
    expect(sheetToAppValues(map, { date: "2026-10-01", cells: { 低強度: "99", 睡眠: "99" },
      values: ["", "", "99", "", "", "4", "", "99", "", "8"] })).toEqual({ builtin: { dist_low: 4 }, custom: { sleep: 8 } });
  });
  it("refuses an ambiguous saved header or keyword fallback instead of choosing the first", () => {
    expect(() => resolveFieldMap(member, [])).toThrow("複数");
    expect(() => resolveFieldMap({ header: ["睡眠", "睡眠"] }, [{ key: "sleep", label: "睡眠", type: "number", sourceColumn: 99, sourceHeader: "睡眠" }])).toThrow("複数");
    expect(() => resolveFieldMap({ header: ["低強度 km", "低強度 m"] }, [])).toThrow("複数");
  });
  it("can follow a moved unique header and does not map hidden custom fields", () => {
    const map = resolveFieldMap({ header: ["睡眠"], columns: [{ index: 7, label: "睡眠" }] },
      [{ key: "sleep", label: "睡眠", type: "number", sourceHeader: "睡眠", sourceColumn: 9 }]);
    expect(map.custom.get("sleep")?.column).toBe(7);
    expect(resolveFieldMap({ header: ["睡眠"] }, [{ key: "sleep", label: "睡眠", type: "number", hidden: true }]).custom.size).toBe(0);
  });
  it("never moves a second explicit mapping to another equal header when its physical column is already claimed", () => {
    expect(() => resolveFieldMap(member, [
      { key: "dist_low", label: "低強度", type: "number", sourceHeader: "低強度", sourceColumn: 5 },
      { key: "duplicate", label: "低強度", type: "number", sourceHeader: "低強度", sourceColumn: 5 },
    ])).toThrow("同じシート列");
  });
});
