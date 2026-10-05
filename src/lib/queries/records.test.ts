import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_NONEMPTY_OR } from "@/lib/record-content";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), fields: vi.fn(), social: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/date", () => ({ jstToday: () => "2026-09-23" }));
vi.mock("./internal", () => ({
  RECORD_LIST_SELECT: "*", attachRecordFieldGroups: mocks.fields, fetchTargetSocialState: mocks.social,
}));
import { getUserRecords, getUserRecordsWithSocialState, getUserTrainingSummary } from "./records";

describe("home training summary", () => {
  const query = { select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lte: vi.fn(), or: vi.fn() };
  const from = vi.fn();
  const rpc = vi.fn();
  beforeEach(() => {
    for (const fn of Object.values(query)) fn.mockReturnValue(query);
    from.mockReturnValue(query);
    mocks.createClient.mockResolvedValue({ from, rpc });
  });

  it("keeps the displayed-distance rule and counts zero-distance records, without loading field definitions", async () => {
    query.or.mockResolvedValue({ data: [
      { dist_low: 1.25, dist_mid: 2.5, dist_high: null, dist_speed: 0.25, dist_actual: 3 },
      { dist_low: 1, dist_mid: 0, dist_high: 0, dist_speed: 0, dist_actual: 5.5 },
      { dist_low: null, dist_mid: null, dist_high: null, dist_speed: null, dist_actual: 0 },
    ], error: null });
    expect(await getUserTrainingSummary("me", "2026-09-17")).toEqual({ distance: 9.5, count: 3 });
    expect(from).toHaveBeenCalledExactlyOnceWith("practice_records");
    expect(query.select).toHaveBeenCalledWith("dist_low,dist_mid,dist_high,dist_speed,dist_actual");
    expect(query.eq).toHaveBeenCalledWith("user_id", "me");
    expect(query.gte).toHaveBeenCalledWith("recorded_date", "2026-09-17");
    expect(query.lte).toHaveBeenCalledWith("recorded_date", "2026-09-23");
    expect(query.or).toHaveBeenCalledWith(RECORD_NONEMPTY_OR);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns zero for an empty period", async () => {
    query.or.mockResolvedValue({ data: [], error: null });
    expect(await getUserTrainingSummary("me", "2026-09-17")).toEqual({ distance: 0, count: 0 });
  });

  it("does not turn a failed request into a misleading zero", async () => {
    const error = { message: "unavailable" };
    query.or.mockResolvedValue({ data: null, error });
    await expect(getUserTrainingSummary("me", "2026-09-17")).rejects.toEqual(error);
  });
});

describe("member public records", () => {
  const todayApp = { id: "app-today", user_id: "owner", recorded_date: "2026-09-23", from_sheet: false, likes_count: 5, custom: { note: "app input" } };
  const todaySheet = {
    id: "sheet-today", user_id: "owner", recorded_date: "2026-09-23", from_sheet: true, likes_count: 8,
    custom: { note: "planned sheet input" }, record_fields_snapshot: [{ key: "note", label: "Note", type: "text" }], record_fields_version: 1,
  };
  const yesterdaySheet = { id: "sheet-yesterday", user_id: "owner", recorded_date: "2026-09-22", from_sheet: true, likes_count: 3, custom: { note: "completed input" } };
  const rows = [todaySheet, todayApp, yesterdaySheet];
  const query = { select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lte: vi.fn(), or: vi.fn(), order: vi.fn(), limit: vi.fn() };
  const from = vi.fn();
  beforeEach(() => {
    for (const fn of Object.values(query)) if (vi.isMockFunction(fn)) fn.mockReturnValue(query);
    Object.assign(query, { then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }) });
    from.mockReturnValue(query);
    mocks.createClient.mockResolvedValue({ from });
    mocks.fields.mockImplementation(async (_, records) => records);
    mocks.social.mockResolvedValue({ liked: new Set(["app-today"]), comments: new Map([["app-today", 2]]) });
  });

  it("retains today's sheet record in the owner's raw record/chart query", async () => {
    const records = await getUserRecords("owner");
    expect(records.map((record) => record.id)).toEqual(["sheet-today", "app-today", "sheet-yesterday"]);
    expect(query.limit).not.toHaveBeenCalled();
    expect(mocks.social).not.toHaveBeenCalled();
  });

  it("publishes today's app record and yesterday's sheet record before loading social data", async () => {
    const records = await getUserRecordsWithSocialState("owner", "viewer");
    expect(records.map((record) => record.id)).toEqual(["app-today", "sheet-yesterday"]);
    expect(records[0]).toMatchObject({ likes_count: 5, liked_by_me: true, comments_count: 2, custom: { note: "app input" } });
    expect(mocks.social).toHaveBeenCalledWith(expect.anything(), "record", ["app-today", "sheet-yesterday"]);
    expect(query.limit).not.toHaveBeenCalled();
    expect(rows).toHaveLength(3);
  });
});
