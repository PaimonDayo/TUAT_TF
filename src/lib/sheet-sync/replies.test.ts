import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawMember } from "@/lib/sheet-public-csv";
const state = vi.hoisted(() => ({ gas: vi.fn(), rpc: vi.fn(), existing: [] as { record_id: string; owner_id: string }[], updates: vi.fn() }));
vi.mock("./gas-client", () => ({ gasPost: state.gas }));
import { reconcileSheetReplies } from "./replies";
const profiles = [{ id: "p", sheet_name: "B1 test" }];
const sourceReply = { replyIndex: 3, content: "deleted comment Author", source: "sheet" as const };
const member = (replies = [sourceReply]): RawMember => ({ name: "B1 test", header: [], records: [{ date: "2026-10-01", cells: {}, replies }] });
const admin = { from(table: string) {
  const q = { select: () => q, in: () => q, eq: () => q, gte: () => q, lte: () => q,
    update: state.updates,
    then(resolve: (value: unknown) => void) { return Promise.resolve({ error: null,
      data: table === "practice_records" ? [{ id: "r", user_id: "p", recorded_date: "2026-10-01" }] :
        table === "sheet_record_replies" ? state.existing : [],
    }).then(resolve); },
  }; return q;
}, rpc: state.rpc } as unknown as SupabaseClient;
const sync = (csv = member(), dryRun = false) => reconcileSheetReplies(admin, profiles, [csv], "2026-10-01", "2026-10-02", dryRun, "october-book");
beforeEach(() => { state.gas.mockReset().mockResolvedValue({ data: member() }); state.rpc.mockReset().mockResolvedValue({ error: null }); state.updates.mockReset(); state.existing = []; });
describe("verified sheet reply imports", () => {
  it("never imports an app-origin copy after the original app comment is gone", async () => {
    const verified = member(); verified.records[0].replies![0] = { ...sourceReply, source: "app" };
    state.gas.mockResolvedValue({ data: verified });
    expect((await sync()).failedMembers).toEqual([]);
    expect(state.rpc).toHaveBeenCalledWith("replace_sheet_record_replies", { target_record_id: "r", reply_rows: [] });
    expect(state.gas).toHaveBeenCalledWith({ action: "fetchMember", memberName: "B1 test", spreadsheetId: "october-book" }, expect.any(AbortSignal));
  });
  it("keeps a genuine sheet reply, using the authenticated response rather than stale CSV", async () => {
    state.gas.mockResolvedValue({ data: member([{ ...sourceReply, content: "current sheet reply" }]) });
    await sync();
    expect(state.rpc).toHaveBeenCalledWith("replace_sheet_record_replies", { target_record_id: "r", reply_rows: [{ replyIndex: 3, content: "current sheet reply" }] });
  });
  it("preserves existing replies on a network failure and reports the member for retry", async () => {
    state.existing = [{ record_id: "r", owner_id: "p" }]; state.gas.mockRejectedValue(new Error("timeout"));
    expect((await sync(member([]))).failedMembers).toEqual([{ member: "B1 test", reason: expect.stringContaining("保持") }]);
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.updates).not.toHaveBeenCalled();
  });
  it("retries a transient read failure once before replacing replies", async () => {
    state.gas.mockRejectedValueOnce(new Error("temporary upstream error"));
    expect((await sync()).failedMembers).toEqual([]);
    expect(state.gas).toHaveBeenCalledTimes(2); expect(state.rpc).toHaveBeenCalledOnce();
  });
  it.each([
    { data: { ...member(), name: "another member" } },
    { data: { ...member(), records: [{ date: "2026-10-01", cells: {} }] } },
    { data: { ...member(), records: [{ date: "2026-10-01", cells: {}, replies: [{ replyIndex: 3, content: "unverified" }] }] } },
    {},
  ])("does not fall back to CSV on malformed metadata: %j", async response => {
    state.existing = [{ record_id: "r", owner_id: "p" }]; state.gas.mockResolvedValue(response);
    expect((await sync()).failedMembers).toHaveLength(1); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("verifies a removal before clearing an existing sheet reply", async () => {
    state.existing = [{ record_id: "r", owner_id: "p" }]; state.gas.mockResolvedValue({ data: member([]) });
    await sync(member([])); expect(state.gas).toHaveBeenCalledOnce();
    expect(state.rpc).toHaveBeenCalledWith("replace_sheet_record_replies", { target_record_id: "r", reply_rows: [] });
  });
  it("skips extra requests when there are no recent or stored replies", async () => {
    await sync(member([])); expect(state.gas).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("checks sources in dry-run without changing the database", async () => {
    expect((await sync(member(), true)).synced).toBe(1); expect(state.gas).toHaveBeenCalledOnce();
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.updates).not.toHaveBeenCalled();
  });
});
