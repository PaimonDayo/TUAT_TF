import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startVisiblePolling } from "./visible-poll";

let surface: EventTarget & { visibilityState: string };
let browser: EventTarget;
let network: { onLine: boolean };
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  surface = Object.assign(new EventTarget(), { visibilityState: "visible" });
  browser = Object.assign(new EventTarget(), { setInterval, clearInterval, setTimeout, clearTimeout });
  network = { onLine: true };
  vi.stubGlobal("document", surface);
  vi.stubGlobal("window", browser);
  vi.stubGlobal("navigator", network);
});
afterEach(async () => {
  stop?.(); stop = undefined;
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it("uses SSR initially and caps requests even when repeatedly switching apps", async () => {
  const load = vi.fn().mockResolvedValue(4);
  stop = startVisiblePolling({ intervalMs: 120_000, load, receive: vi.fn() });
  for (let i = 0; i < 119; i++) {
    surface.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(load).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(load).toHaveBeenCalledTimes(1);
});

it("skips hidden/offline requests and resumes once when due", async () => {
  const load = vi.fn().mockResolvedValue(0);
  const receive = vi.fn();
  surface.visibilityState = "hidden";
  stop = startVisiblePolling({ intervalMs: 120_000, load, receive });
  await vi.advanceTimersByTimeAsync(600_000);
  surface.visibilityState = "visible";
  network.onLine = false;
  surface.dispatchEvent(new Event("visibilitychange"));
  expect(load).not.toHaveBeenCalled();
  network.onLine = true;
  browser.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).toHaveBeenCalledWith(0);
  surface.dispatchEvent(new Event("visibilitychange"));
  expect(load).toHaveBeenCalledTimes(1);
});

it("does not overlap, aborts on unmount, and ignores late responses", async () => {
  let finish!: (value: number) => void;
  const load = vi.fn((signal: AbortSignal) => new Promise<number>(resolve => { expect(signal.aborted).toBe(false); finish = resolve; }));
  const receive = vi.fn();
  stop = startVisiblePolling({ intervalMs: 1000, load, receive, immediate: true });
  await vi.advanceTimersByTimeAsync(2000);
  expect(load).toHaveBeenCalledTimes(1);
  stop();
  expect(load.mock.calls[0][0].aborted).toBe(true);
  finish(8);
  await vi.advanceTimersByTimeAsync(1000);
  expect(receive).not.toHaveBeenCalled();
});

it("bounds slow requests, keeps existing data on failure and retries at the interval", async () => {
  const receive = vi.fn();
  const load = vi.fn((signal: AbortSignal) => new Promise<number>((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
  }));
  stop = startVisiblePolling({ intervalMs: 120_000, load, receive, immediate: true });
  await vi.advanceTimersByTimeAsync(25_000);
  expect(load.mock.calls[0][0].aborted).toBe(true);
  expect(receive).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(95_000);
  expect(load).toHaveBeenCalledTimes(2);
});
