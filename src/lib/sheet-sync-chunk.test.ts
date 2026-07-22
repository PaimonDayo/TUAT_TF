import { describe, expect, it } from "vitest";
import { sheetSyncChunkSize } from "./sheet-sync-chunk";

describe("sheetSyncChunkSize", () => {
  it("uses 16 by default", () => expect(sheetSyncChunkSize(undefined)).toBe(16));
  it("accepts a configured size", () => expect(sheetSyncChunkSize("12")).toBe(12));
  it("clamps zero to one", () => expect(sheetSyncChunkSize("0")).toBe(1));
  it("clamps negative values to one", () => expect(sheetSyncChunkSize("-5")).toBe(1));
  it("clamps large values to 30", () => expect(sheetSyncChunkSize("100")).toBe(30));
  it("falls back for non-numeric values", () => expect(sheetSyncChunkSize("invalid")).toBe(16));
  it("parses integer prefixes consistently", () => expect(sheetSyncChunkSize("8.5")).toBe(8));
});
