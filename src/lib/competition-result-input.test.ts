import { describe, expect, it } from "vitest";
import {
  initialResultInput,
  initialResultValues,
  measureForResultInput,
  resultInputPreset,
  resultTimeFields,
  type ResultInputFormat,
} from "./competition-result-input";

describe("standard event input presets", () => {
  const cases: [string, ResultInputFormat, boolean][] = [
    ["100m", "seconds", true], ["200m", "seconds", true], ["400m", "seconds", false],
    ["800m", "minutes", false], ["1500m", "minutes", false], ["3000m", "minutes", false],
    ["5000m", "minutes", false], ["10000m", "minutes", false],
    ["100mH", "seconds", true], ["110mH", "seconds", true], ["400mH", "seconds", false],
    ["3000mSC", "minutes", false], ["5000mW", "minutes", false], ["10000mW", "minutes", false],
    ["4×100mR", "seconds", false], ["4×400mR", "minutes", false],
    ["走高跳", "meters", false], ["棒高跳", "meters", false],
    ["走幅跳", "meters", true], ["三段跳", "meters", true],
    ["砲丸投", "meters", false], ["円盤投", "meters", false],
    ["ハンマー投", "meters", false], ["やり投", "meters", false],
    ["七種競技", "points", false], ["十種競技", "points", false],
    ["ハーフ", "hours", false], ["マラソン", "hours", false], ["駅伝", "hours", false],
  ];
  it.each(cases)("chooses the fields for %s", (name, format, wind) => {
    expect(resultInputPreset(name, [])).toMatchObject({ format, wind });
  });
  it.each(["走高跳", "棒高跳", "走り高跳び"])("labels height for %s", (name) => {
    expect(resultInputPreset(name, []).distanceLabel).toBe("高さ（m）");
  });
  it.each([
    ["女子 １００ｍハードル", "100mH"], ["男子１１０ＭＨ", "110mH"],
    ["U20男子 110mH", "110mH"], ["女子 ４x４００ｍリレー", "4×400mR"],
    ["男女混合4×100m", "4×100mR"], ["走り幅跳び", "走幅跳"],
    ["三段跳び", "三段跳"], ["砲丸投げ", "砲丸投"], ["やり投げ", "やり投"],
    ["3000m障害", "3000mSC"], ["5000m競歩", "5000mW"], ["ハーフマラソン", "ハーフ"],
  ])("recognizes a precise variant %s", (variant, canonical) => {
    expect(resultInputPreset(variant, [])).toEqual(resultInputPreset(canonical, []));
  });
  it("does not detect a short sprint inside a relay or a custom name", () => {
    expect(resultInputPreset("4×100mR", []).wind).toBe(false);
    expect(resultInputPreset("100m通過", [])).toMatchObject({ format: "minutes", wind: false });
    expect(resultInputPreset("室内100m", []).wind).toBe(false);
  });
  it.each(["constructor", "toString", "__proto__"])("treats %s as a custom name", (name) => {
    expect(resultInputPreset(name, [])).toEqual({ format: "minutes", wind: false, distanceLabel: "距離（m）" });
  });
  it("uses catalog units for custom events while keeping their wind optional", () => {
    const events = [
      { name: "300mH", measure_type: "time", time_format: "seconds" },
      { name: "立ち五段", measure_type: "distance" },
      { name: "独自混成", measure_type: "points" },
      { name: "長い区間", measure_type: "time", time_format: "minutes" },
      { name: "4×400mR", measure_type: "time", time_format: "seconds" },
    ];
    expect(resultInputPreset("300mH", events)).toMatchObject({ format: "seconds", wind: false });
    expect(resultInputPreset("立ち五段", events)).toMatchObject({ format: "meters", wind: false });
    expect(resultInputPreset("独自混成", events).format).toBe("points");
    expect(resultInputPreset("長い区間", events).format).toBe("minutes");
    expect(resultInputPreset("4×400mR", events).format).toBe("minutes");
  });
});

describe("editing existing result types", () => {
  it("prefers stored metric and point values for custom or renamed events", () => {
    expect(initialResultInput({ event_name: "独自跳躍", value_cm: 1234 }, []).format).toBe("meters");
    expect(initialResultInput({ event_name: "独自混成", value_points: 5321 }, []).format).toBe("points");
    expect(initialResultInput({ event_name: "100m", value_cm: 1234 }, []).format).toBe("meters");
    expect(initialResultInput({ event_name: "走幅跳", value_cs: 93240, record: "15:32.40" }, []).format).toBe("minutes");
  });
  it.each([
    [{ value_cs: 20015, record: "200.15" }, "seconds"],
    [{ value_cs: 375345, record: "3753.45" }, "seconds"],
    [{ value_cs: 10080000, record: "100800" }, "seconds"],
    [{ value_cs: 375345, record: "1:02:33.45" }, "hours"],
    [{ value_cs: 375345 }, "hours"],
    [{ record: "1時間2分33秒45" }, "hours"],
    [{ record: "15:32.40" }, "minutes"],
    [{ record: "6m85" }, "meters"],
    [{ record: "14.20m" }, "meters"],
    [{ record: "5321点" }, "points"],
  ])("infers other-event input from existing values %j", (value, format) => {
    expect(initialResultInput({ event_name: "削除済み種目", ...value }, []).format).toBe(format);
  });
  it("retains a custom catalog format and a known long-distance preset", () => {
    const events = [{ name: "300m", measure_type: "time", time_format: "seconds" }];
    expect(initialResultInput({ event_name: "300m", value_cs: 4250 }, events).format).toBe("seconds");
    expect(initialResultInput({ event_name: "10000m", value_cs: 375345 }, []).format).toBe("minutes");
  });
  it("keeps an existing wind of zero or either sign visible, except for points", () => {
    for (const wind of [0, -1.2, 1.2])
      expect(initialResultInput({ event_name: "400m", wind }, []).wind).toBe(true);
    expect(initialResultInput({ event_name: "400m", wind: null }, []).wind).toBe(false);
    expect(initialResultInput({ event_name: "十種競技", wind: 1.2 }, []).wind).toBe(false);
    expect(initialResultInput({ event_name: "100m", value_points: 500, wind: 0 }, []).wind).toBe(false);
  });
});

describe("initial input values and time units", () => {
  it("retains structured values instead of parsing a conflicting old string", () => {
    expect(initialResultValues({ event_name: "走幅跳", value_cm: 685, record: "5.00" }, "meters"))
      .toEqual({ value_cs: null, value_cm: 685, value_points: null });
    expect(initialResultValues({ event_name: "十種競技", value_points: 0, record: "5321" }, "points").value_points).toBe(0);
  });
  it.each([
    ["２００.１５", "seconds", "value_cs", 20015],
    ["200.15秒", "seconds", "value_cs", 20015],
    ["100800", "seconds", "value_cs", 10080000],
    ['11"32', "seconds", "value_cs", 1132],
    ['15\'32"4', "minutes", "value_cs", 93240],
    ["1:02:33.45", "hours", "value_cs", 375345],
    ["6.85", "meters", "value_cm", 685],
    ["6m85", "meters", "value_cm", 685],
    ["100.25m", "meters", "value_cm", 10025],
    ["5321点", "points", "value_points", 5321],
  ] as const)("parses legacy %s using its own metric", (record, format, key, value) => {
    expect(initialResultValues({ event_name: "その他", record }, format)[key]).toBe(value);
  });
  it("leaves unreadable legacy text empty for the form to preserve separately", () => {
    expect(initialResultValues({ event_name: "その他", record: "記録不明" }, "minutes"))
      .toEqual({ value_cs: null, value_cm: null, value_points: null });
  });
  it("converts the same stored time among input units without losing hours or hundredths", () => {
    expect(resultTimeFields(375345, "seconds")).toEqual({ hours: "", minutes: "", seconds: "3753.45" });
    expect(resultTimeFields(375345, "minutes")).toEqual({ hours: "", minutes: "62", seconds: "33.45" });
    expect(resultTimeFields(375345, "hours")).toEqual({ hours: "1", minutes: "2", seconds: "33.45" });
    expect(resultTimeFields(360000, "hours")).toEqual({ hours: "1", minutes: "0", seconds: "0" });
    expect(resultTimeFields(10080000, "seconds")).toEqual({ hours: "", minutes: "", seconds: "100800" });
    expect(resultTimeFields(10080000, "minutes")).toEqual({ hours: "", minutes: "1680", seconds: "0" });
    expect(resultTimeFields(10080000, "hours")).toEqual({ hours: "28", minutes: "0", seconds: "0" });
    expect(resultTimeFields(null, "minutes")).toEqual({ hours: "", minutes: "", seconds: "" });
  });
  it.each([
    ["seconds", "time"], ["minutes", "time"], ["hours", "time"],
    ["meters", "distance"], ["points", "points"],
  ] as const)("maps %s input to the existing %s storage type", (format, measure) => {
    expect(measureForResultInput(format)).toBe(measure);
  });
});
