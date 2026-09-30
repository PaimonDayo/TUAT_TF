import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const gas = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
vi.mock("./gas-client", () => ({ gasPost: gas }));
import { sheetForRecord } from "./period-routing";
import { flushReplyDeletions } from "./reply-deletions";

function client(mode: string, job: Record<string, unknown> = {}) {
  return { from(table: string) {
    const data = table === "profiles" ? { sheet_name: "new", record_fields: [], sheet_transition: {
      version: "2026-10", mode, legacy: { sheet_name: "old", record_fields: [] },
    } } : table === "practice_records" ? { user_id: "pilot" } : table === "profile_roles" ? [{ profile_id: "pilot" }]
      : [{ id: "job", record_id: "record", sheet_name: "new", recorded_date: "2026-10-01", spreadsheet_id: "18HKZrVL-JtXbZ9zcYUFPRPGIGCpd7ltLOsmvBKdJfR8", ...job }];
    const q = { select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => q, update: () => q,
      single: async () => ({ data, error: null }), maybeSingle: async () => ({ data, error: null }),
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data, error: null }).then(resolve) };
    return q;
  } } as unknown as SupabaseClient;
}
describe("disconnected outbound synchronization", () => {
  it("provides no destination for records, comments, or clears in either period", async () => {
    expect(await sheetForRecord(client("off"), "pilot", "2026-09-30")).toBeNull();
    expect(await sheetForRecord(client("off"), "pilot", "2026-10-01")).toBeNull();
  });
  it("holds queued reply deletion while disconnected and resumes after reconnecting", async () => {
    gas.mockClear();
    expect(await flushReplyDeletions(client("off"))).toEqual([]);
    expect(gas).not.toHaveBeenCalled();
    expect(await flushReplyDeletions(client("app_only"))).toEqual([]);
    expect(gas).toHaveBeenCalledTimes(1);
  });
  it("never sends an October deletion with an unverified destination to the old sheet", async () => {
    gas.mockClear();
    expect(await flushReplyDeletions(client("sheet", { spreadsheet_id: null }))).toEqual([]);
    expect(gas).not.toHaveBeenCalled();
  });
  it("honors the cutoff for older receipts created before the all-member rollout", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T15:00:00Z"));
    try {
      gas.mockClear();
      expect(await flushReplyDeletions(client("sheet", { recorded_date: "2026-09-30", legacy_period: false }))).toEqual([]);
      expect(gas).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
