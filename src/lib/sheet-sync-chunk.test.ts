import { describe, expect, it } from "vitest";
import { sheetSyncChunkSize } from "./sheet-sync-chunk";

describe("sheetSyncChunkSize", () => {
  it("uses 100 by default", () => expect(sheetSyncChunkSize(undefined)).toBe(100));
  it("accepts a configured size", () => expect(sheetSyncChunkSize("40")).toBe(40));
  it("clamps zero to one", () => expect(sheetSyncChunkSize("0")).toBe(1));
  it("clamps negative values to one", () => expect(sheetSyncChunkSize("-5")).toBe(1));
  it("clamps large values to 100", () => expect(sheetSyncChunkSize("250")).toBe(100));
  it("falls back for non-numeric values", () => expect(sheetSyncChunkSize("invalid")).toBe(100));
  it("parses integer prefixes consistently", () => expect(sheetSyncChunkSize("8.5")).toBe(8));
});
