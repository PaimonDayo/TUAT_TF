import { describe, expect, it } from "vitest";
import {
  formatCentimeters,
  formatCentiseconds,
  formatRecord,
  formatRecordedOn,
  formatWind,
  fromCentiseconds,
  measureTypeOf,
  parseRecordText,
  recordGroupKey,
  toCentiseconds,
} from "./competition-record";

describe("time values", () => {
  it("keeps hundredths through the round trip", () => {
    const cs = toCentiseconds({ minutes: 15, seconds: 32, centis: 40 });
    expect(cs).toBe(93_240);
    expect(fromCentiseconds(cs)).toEqual({
      hours: 0,
      minutes: 15,
      seconds: 32,
      centis: 40,
    });
  });
  it("formats by magnitude", () => {
    expect(formatCentiseconds(93_240)).toBe(`15'32"40`);
    expect(formatCentiseconds(toCentiseconds({ hours: 1, minutes: 2, seconds: 33, centis: 5 }))).toBe("1:02:33.05");
    expect(formatCentiseconds(toCentiseconds({ seconds: 11, centis: 3 }))).toBe(`11"03`);
  });
  it("ignores negative and missing parts", () => {
    expect(toCentiseconds({ minutes: -3, seconds: 9 })).toBe(900);
  });
});

describe("distance and wind", () => {
  it("formats metres and centimetres", () => {
    expect(formatCentimeters(685)).toBe("6m85");
    expect(formatCentimeters(1_420)).toBe("14m20");
    expect(formatCentimeters(600)).toBe("6m00");
  });
  it("signs the wind", () => {
    expect(formatWind(1.2)).toBe("+1.2");
    expect(formatWind(-0.3)).toBe("-0.3");
    expect(formatWind(0)).toBe("±0.0");
  });
});

describe("formatRecord", () => {
  it("prefers the structured value", () => {
    expect(formatRecord({ value_cs: 93_240, record: "旧テキスト" }, "time")).toBe(`15'32"40`);
    expect(formatRecord({ value_cm: 685, record: "旧テキスト" }, "distance")).toBe("6m85");
    expect(formatRecord({ value_points: 5_321 }, "points")).toBe("5321点");
  });
  it("falls back to the legacy text", () => {
    expect(formatRecord({ record: `15'32"4` }, "time")).toBe(`15'32"4`);
  });
  it("shows the status instead of a value", () => {
    expect(formatRecord({ result_status: "DNS", value_cs: 100 }, "time")).toBe("欠場");
    expect(formatRecord({ result_status: "NM" }, "distance")).toBe("記録なし");
  });
});

describe("dates and grouping", () => {
  it("rounds the display to the entered precision", () => {
    expect(formatRecordedOn("2026-09-21", "day")).toBe("2026/9/21");
    expect(formatRecordedOn("2026-09-01", "month")).toBe("2026年9月");
    expect(formatRecordedOn("2024-01-01", "year")).toBe("2024年");
    expect(formatRecordedOn(null, "day")).toBe("");
  });
  it("groups every pre-university record together", () => {
    expect(recordGroupKey({ stage: "pre_university", recorded_on: "2022-06-01" })).toBe("大学以前");
    expect(recordGroupKey({ stage: "university", recorded_on: "2026-06-01" })).toBe("2026年");
    expect(recordGroupKey({ stage: "university", recorded_on: null })).toBe("日付未設定");
  });
});

describe("measureTypeOf", () => {
  const events = [
    { name: "5000m", measure_type: "time" },
    { name: "走幅跳", measure_type: "distance" },
    { name: "十種競技", measure_type: "points" },
    { name: "壊れた値", measure_type: "bogus" },
  ];
  it("reads the catalog and falls back to time", () => {
    expect(measureTypeOf(events, "走幅跳")).toBe("distance");
    expect(measureTypeOf(events, "十種競技")).toBe("points");
    expect(measureTypeOf(events, "壊れた値")).toBe("time");
    expect(measureTypeOf(events, "未登録")).toBe("time");
  });
});

describe("parseRecordText", () => {
  it("reads the shapes that exist in the current data", () => {
    expect(parseRecordText(`15'32"4`, "time")).toEqual({ value_cs: 93_240 });
    expect(parseRecordText("15:32.40", "time")).toEqual({ value_cs: 93_240 });
    expect(parseRecordText("15分32秒4", "time")).toEqual({ value_cs: 93_240 });
    expect(parseRecordText("1:02:33.45", "time")).toEqual({ value_cs: 375_345 });
    expect(parseRecordText("11.32", "time")).toEqual({ value_cs: 1_132 });
    expect(parseRecordText("6m85", "distance")).toEqual({ value_cm: 685 });
    expect(parseRecordText("6.85m", "distance")).toEqual({ value_cm: 685 });
    expect(parseRecordText("14m2", "distance")).toEqual({ value_cm: 1_420 });
    expect(parseRecordText("5321点", "points")).toEqual({ value_points: 5_321 });
  });
  it("returns null when it cannot be sure", () => {
    expect(parseRecordText("自己ベスト更新", "time")).toBeNull();
    expect(parseRecordText("", "time")).toBeNull();
    expect(parseRecordText("6m85", "points")).toBeNull();
  });
});
