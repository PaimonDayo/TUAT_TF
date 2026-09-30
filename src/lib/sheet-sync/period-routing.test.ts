import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sheetForRecord } from "./period-routing";
import { OCTOBER_SHEET_ID } from "../sheet-period";

function client(confirmed: boolean) {
  return { from(table: string) {
    expect(table).toBe("profiles"); // No role gate or role-query dependency.
    const q = { select: () => q, eq: () => q, single: async () => ({ error: null, data: {
      sheet_name: "new", record_fields: [], sheet_transition: confirmed ? {
        version: "2026-10", mode: "sheet", legacy: { sheet_name: "old", record_fields: [] },
      } : null,
    } }) };
    return q;
  } } as unknown as SupabaseClient;
}
afterEach(() => vi.useRealTimers());
describe("all-member record destinations", () => {
  it("routes an ordinary member to the confirmed October workbook", async () => {
    expect(await sheetForRecord(client(true), "member", "2026-10-01"))
      .toEqual({ sheetName: "new", fields: [], spreadsheetId: OCTOBER_SHEET_ID });
  });
  it("holds an unconfirmed October send instead of writing the old workbook", async () => {
    await expect(sheetForRecord(client(false), "member", "2026-10-01")).rejects.toThrow("先に確認");
  });
  it("preserves the old destination only until the common cutoff", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T14:59:59Z"));
    expect(await sheetForRecord(client(true), "member", "2026-09-30"))
      .toEqual({ sheetName: "old", fields: [] });
    vi.setSystemTime(new Date("2026-10-07T15:00:00Z"));
    expect(await sheetForRecord(client(true), "member", "2026-09-30")).toBeNull();
    expect(await sheetForRecord(client(false), "member", "2026-09-30")).toBeNull();
  });
});
