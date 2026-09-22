import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { middleLongMenuQueryOptions } from "./middle-long-menus";
import type { ScheduleWithMenus } from "@/types";

const practice = { schedule_type: "practice", schedule_date: "2026-09-23", target_blocks: ["middle_long"] } as ScheduleWithMenus;
const snapshot = { rows: [], loadedMonths: [8, 9] };
afterEach(() => vi.unstubAllGlobals());

describe("on-demand home menus", () => {
  it("does not fetch collapsed cards, coalesces opens, and reuses fresh data on reopen", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot });
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient();
    const options = (enabled: boolean) => middleLongMenuQueryOptions({ userId: "me", schedules: [practice], enabled });
    const first = new QueryObserver(client, options(false));
    const second = new QueryObserver(client, options(false));
    const off1 = first.subscribe(() => {});
    const off2 = second.subscribe(() => {});
    try {
      expect(fetcher).not.toHaveBeenCalled();
      first.setOptions(options(true));
      second.setOptions(options(true));
      await vi.waitFor(() => expect(first.getCurrentResult().data).toEqual(snapshot));
      expect(fetcher).toHaveBeenCalledTimes(1);
      first.setOptions(options(false));
      first.setOptions(options(true));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith("/api/middle-long-menus?months=8,9", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    } finally { off1(); off2(); client.clear(); }
  });

  it("does not request CSV for competitions, short-only practices, hidden menus or missing users", () => {
    for (const schedule of [{ ...practice, schedule_type: "competition" }, { ...practice, target_blocks: ["short"] }]) {
      expect(middleLongMenuQueryOptions({ userId: "me", schedules: [schedule as ScheduleWithMenus], enabled: true }).enabled).toBe(false);
    }
    expect(middleLongMenuQueryOptions({ userId: "me", schedules: [practice], enabled: false }).enabled).toBe(false);
    expect(middleLongMenuQueryOptions({ userId: undefined, schedules: [practice], enabled: true }).enabled).toBe(false);
  });

  it("keeps users in separate caches and disables automatic error retries/focus refetches", async () => {
    const options = middleLongMenuQueryOptions({ userId: "me", schedules: [practice], enabled: true });
    const other = middleLongMenuQueryOptions({ userId: "other", schedules: [practice], enabled: true });
    expect(options.queryKey).not.toEqual(other.queryKey);
    expect(options).toMatchObject({ retry: false, refetchOnWindowFocus: false, staleTime: 60_000 });
    const client = new QueryClient();
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(client.fetchQuery(options)).rejects.toThrow("Failed to load");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { client.clear(); }
  });
});
