import { describe, expect, it } from "vitest";
import { sheetRecordCreatedAt } from "./sheet-sync";

describe("sheetRecordCreatedAt", () => {
  const importedAt = new Date("2026-09-13T15:00:00.000Z"); // JST 9/14 0:00 の同期

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
});
