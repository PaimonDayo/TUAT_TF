import { afterEach, describe, expect, it, vi } from "vitest";
import { jstNow, jstToday, shiftMonth } from "./date";

afterEach(() => { vi.useRealTimers(); });

describe("JST date helpers", () => {
  it("uses the next JST date before UTC midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T15:30:00.000Z"));
    expect(jstToday()).toBe("2026-07-21");
  });
  it("supports positive day offsets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T15:30:00.000Z"));
    expect(jstToday(1)).toBe("2026-07-22");
  });
  it("supports negative day offsets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T15:30:00.000Z"));
    expect(jstToday(-1)).toBe("2026-07-20");
  });
  it("returns a Date representing JST wall-clock time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T15:30:00.000Z"));
    const value = jstNow();
    expect(value.getFullYear()).toBe(2026);
    expect(value.getMonth()).toBe(6);
    expect(value.getDate()).toBe(21);
    expect(value.getHours()).toBe(0);
    expect(value.getMinutes()).toBe(30);
  });
});

describe("shiftMonth", () => {
  it("moves across year boundaries in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", 15)).toBe("2028-01");
  });

  it("keeps February reachable from month-end dates, including leap years", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-31T23:30:00Z"));
    expect(shiftMonth("2026-01", 1)).toBe("2026-02");
    expect(shiftMonth("2024-03", -1)).toBe("2024-02");
    expect(shiftMonth("2026-02", 0)).toBe("2026-02");
  });
});
