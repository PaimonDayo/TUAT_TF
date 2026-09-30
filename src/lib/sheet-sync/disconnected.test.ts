import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const gas = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
vi.mock("./gas-client", () => ({ gasPost: gas }));
import { sheetForRecord } from "./period-routing";
import { flushReplyDeletions } from "./reply-deletions";

function client(mode: string) {
  return { from(table: string) {
    const data = table === "profiles" ? { sheet_name: "new", record_fields: [], sheet_transition: {
      version: "2026-10", mode, legacy: { sheet_name: "old", record_fields: [] },
    } } : table === "practice_records" ? { user_id: "pilot" } : table === "profile_roles" ? [{ profile_id: "pilot" }]
      : [{ id: "job", record_id: "record", sheet_name: "new", recorded_date: "2026-10-01" }];
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
});
