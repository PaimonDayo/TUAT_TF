import { describe, expect, it } from "vitest";
import { competitionDays, isTypedResultOf, sameMeetName } from "./competition-days";

describe("competitionDays", () => {
  it("lists every day of a multi-day meet", () => {
    expect(competitionDays("2026-09-21", "2026-09-23")).toEqual(["2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(competitionDays("2026-09-30", "2026-10-01")).toEqual(["2026-09-30", "2026-10-01"]);
  });
  it("returns the first day only for a one-day or undated end", () => {
    expect(competitionDays("2026-09-21", null)).toEqual(["2026-09-21"]);
    expect(competitionDays("2026-09-21", "2026-09-20")).toEqual(["2026-09-21"]);
  });
});

describe("typed meet names", () => {
  const meet = { name: "27大戦", starts_on: "2026-09-21", ends_on: "2026-09-23" };
  it("ignores width and spaces in names", () => {
    expect(sameMeetName("２７大戦 ", "27大戦")).toBe(true);
    expect(sameMeetName("", "")).toBe(false);
  });
  it("counts a result only when the name and a meet day both match", () => {
    expect(isTypedResultOf({ meet_name: "27大戦", recorded_on: "2026-09-22", date_precision: "day" }, meet)).toBe(true);
    expect(isTypedResultOf({ meet_name: "27大戦", recorded_on: "2026-09-01", date_precision: "day" }, meet)).toBe(false);
    expect(isTypedResultOf({ meet_name: "27大戦", recorded_on: null }, meet)).toBe(false);
    expect(isTypedResultOf({ meet_name: "27大戦", recorded_on: "2026-09-01", date_precision: "month" }, meet)).toBe(false);
    expect(isTypedResultOf({ meet_name: "15大戦", recorded_on: "2026-09-22", date_precision: "day" }, meet)).toBe(false);
  });
});
