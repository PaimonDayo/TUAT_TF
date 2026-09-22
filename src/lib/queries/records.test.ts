import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_NONEMPTY_OR } from "@/lib/record-content";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/date", () => ({ jstToday: () => "2026-09-23" }));
import { getUserTrainingSummary } from "./records";

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
