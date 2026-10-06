import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sheetRecordCreatedAt } from "./sheet-sync";
import { sheetPullThrough } from "./sheet-sync/dates";

describe("sheetPullThrough", () => {
  it("includes today for manual imports and uses yesterday for cron imports", () => {
    expect(sheetPullThrough("2026-10-06")).toBe("2026-10-06");
    expect(sheetPullThrough("2026-10-06", false)).toBe("2026-10-05");
  });

  it("preserves the previous day across month, year, and leap-year boundaries", () => {
    expect(sheetPullThrough("2026-10-01", false)).toBe("2026-09-30");
    expect(sheetPullThrough("2027-01-01", false)).toBe("2026-12-31");
    expect(sheetPullThrough("2028-03-01", false)).toBe("2028-02-29");
  });
});

describe("sheetRecordCreatedAt", () => {
  const importedAt = new Date("2026-09-13T15:00:00.000Z"); // JST 9/14 0:00 の同期

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(importedAt); });
  afterEach(() => { vi.useRealTimers(); });

  it("取り込んだ時刻を投稿時刻にする（タイムラインの一番上に出る）", () => {
    // 練習日そのものではなく、取り込んだ時刻の近傍になる。
    const at = Date.parse(sheetRecordCreatedAt("2026-04-12", importedAt));
    expect(at).toBeLessThanOrEqual(importedAt.getTime());
    expect(importedAt.getTime() - at).toBeLessThanOrEqual(1000);
  });

  it("同じ取り込みでは、練習日が新しいものほど上に来る", () => {
    const newer = Date.parse(sheetRecordCreatedAt("2026-09-12", importedAt));
    const older = Date.parse(sheetRecordCreatedAt("2026-09-10", importedAt));
    expect(newer).toBeGreaterThan(older);
  });

  it("未来日でも取り込んだ時刻より後にはしない", () => {
    const future = Date.parse(sheetRecordCreatedAt("2099-01-01", importedAt));
    expect(future).toBe(importedAt.getTime());
  });

  it("uses the supplied batch time even when rows are processed on another day", () => {
    vi.setSystemTime(new Date("2026-10-05T15:00:00Z"));
    expect(sheetRecordCreatedAt("2026-09-12", importedAt)).toBe("2026-09-13T14:59:59.998Z");
  });

  it("keeps initial history before the latest eligible date at the practice day's JST midnight", () => {
    expect(sheetRecordCreatedAt("2026-09-12", importedAt, "2026-09-13")).toBe("2026-09-11T15:00:00.000Z");
    expect(sheetRecordCreatedAt("2026-09-13", importedAt, "2026-09-13")).toBe("2026-09-13T14:59:59.999Z");
  });

  it("distinguishes initial history from the latest eligible day across New Year", () => {
    const newYearBatch = new Date("2026-12-31T15:00:00.000Z");
    expect(sheetRecordCreatedAt("2026-12-30", newYearBatch, "2026-12-31")).toBe("2026-12-29T15:00:00.000Z");
    expect(sheetRecordCreatedAt("2026-12-31", newYearBatch, "2026-12-31")).toBe("2026-12-31T14:59:59.999Z");
  });
});
