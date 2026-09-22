import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startCompetitionProgramPolling } from "./competition-program-poll";

let surface: EventTarget & { visibilityState: string };
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  surface = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", surface);
  vi.stubGlobal("window", globalThis);
});
afterEach(async () => {
  stop?.();
  stop = undefined;
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("competition-only refresh", () => {
  it("uses SSR initially, then fetches at most once per five minutes", async () => {
    const load = vi.fn().mockResolvedValue(["updated result"]);
    const receive = vi.fn();
    stop = startCompetitionProgramPolling(load, receive, () => true);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(receive).toHaveBeenCalledWith(["updated result"]);
    for (let i = 0; i < 5; i++) surface.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("pauses while hidden and refreshes once when returning after five minutes", async () => {
    const load = vi.fn().mockResolvedValue([]);
    stop = startCompetitionProgramPolling(load, vi.fn(), () => true);
    surface.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(900_000);
    expect(load).not.toHaveBeenCalled();
    surface.visibilityState = "visible";
    surface.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("does not poll outside the competition dates, and starts when the day changes", async () => {
    let competitionDay = false;
    const load = vi.fn().mockResolvedValue([]);
    stop = startCompetitionProgramPolling(load, vi.fn(), () => competitionDay);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(load).not.toHaveBeenCalled();
    competitionDay = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("keeps existing data on failure, retries at the next interval and accepts a real empty result", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    const receive = vi.fn();
    stop = startCompetitionProgramPolling(load, receive, () => true);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(receive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(receive).toHaveBeenCalledWith([]);
  });
  it("does not overlap requests and rejects late data after navigation or a new SSR result", async () => {
    let finish!: (data: string[]) => void;
    const load = vi.fn(() => new Promise<string[]>(resolve => { finish = resolve; }));
    const receive = vi.fn();
    stop = startCompetitionProgramPolling(load, receive, () => true);
    await vi.advanceTimersByTimeAsync(300_000);
    surface.dispatchEvent(new Event("visibilitychange"));
    expect(load).toHaveBeenCalledTimes(1);
    stop();
    finish(["obsolete"]);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(receive).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("aborts a slow request after 25 seconds and can retry later", async () => {
    const load = vi.fn((signal: AbortSignal) => new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    stop = startCompetitionProgramPolling(load, vi.fn(), () => true);
    await vi.advanceTimersByTimeAsync(325_000);
    expect(load.mock.calls[0][0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(275_000);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
