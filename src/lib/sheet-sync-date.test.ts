import { describe, expect, it } from "vitest";
import { sheetRecordCreatedAt } from "./sheet-sync";

describe("sheetRecordCreatedAt", () => {
  it("uses the spreadsheet record date instead of the import time", () => {
    expect(sheetRecordCreatedAt("2026-04-12")).toBe("2026-04-12T00:00:00+09:00");
  });
});
