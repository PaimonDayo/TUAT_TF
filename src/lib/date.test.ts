import { afterEach, describe, expect, it, vi } from "vitest";
import { jstNow, jstToday } from "./date";

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
