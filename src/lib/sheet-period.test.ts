import { afterEach, describe, expect, it, vi } from "vitest";
import { legacySyncOpen, periodContains } from "./sheet-period";
import { parseMemberCsv } from "./sheet-public-csv";

afterEach(() => vi.useRealTimers());
describe("October sheet boundaries", () => {
  it("ends old synchronization exactly at October 8 midnight JST", () => {
    expect(legacySyncOpen(new Date("2026-10-07T14:59:59.999Z"))).toBe(true);
    expect(legacySyncOpen(new Date("2026-10-07T15:00:00Z"))).toBe(false);
    expect(periodContains("2026-09-30", "legacy", new Date("2026-10-07T14:59:59Z"))).toBe(true);
    expect(periodContains("2026-10-01", "legacy")).toBe(false);
    expect(periodContains("2026-09-30", "october")).toBe(false);
    expect(periodContains("2026-10-01", "october")).toBe(true);
    expect(periodContains("2026-09-30", "unchanged", new Date("2027-01-01"))).toBe(true);
  });
  it("keeps the October workbook dates stable across New Year", () => {
    const csv = "日付,感想\n10/1,秋\n12/31,年末\n1/1,年明け\n3/31,春\n2026/9/30,旧日付";
    expect(parseMemberCsv({ name: "B1 test", gid: "1" }, csv, 2026, 10).records.map(r => r.date))
      .toEqual(["2026-10-01", "2026-12-31", "2027-01-01", "2027-03-31", "2026-09-30"]);
  });
});
