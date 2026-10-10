import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { obResultsFeedToken } from "./ob-results-feed-auth";
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => callback() }));
import { notifyObResults } from "./ob-results-notify";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
it("sends only a signed wake-up and handles failure without retrying a save", async () => {
  vi.stubEnv("SHEET_SYNC_SECRET", "synthetic-key");
  const request = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
  vi.stubGlobal("fetch", request);
  expect(await notifyObResults()).toBe(true);
  const options = request.mock.calls[0][1];
  const body = JSON.parse(options.body);
  expect(Object.keys(body).sort()).toEqual(["action", "signature", "timestamp"]);
  expect(body.signature).toBe(createHmac("sha256", obResultsFeedToken("synthetic-key")).update(`ob-publish:${body.timestamp}`).digest("hex"));
  request.mockRejectedValueOnce(new Error("response lost"));
  expect(await notifyObResults()).toBe(false);
  expect(request).toHaveBeenCalledTimes(2);
});
it("retries a busy publisher, and sends nothing without configuration", async () => {
  vi.stubEnv("SHEET_SYNC_SECRET", "");
  const request=vi.fn(); vi.stubGlobal("fetch",request);
  expect(await notifyObResults()).toBe(false); expect(request).not.toHaveBeenCalled();
  vi.stubEnv("SHEET_SYNC_SECRET", "synthetic-key"); vi.useFakeTimers();
  request.mockResolvedValueOnce(new Response('{"ok":false,"busy":true}')).mockResolvedValueOnce(new Response('{"ok":true}'));
  const result=notifyObResults(); await vi.runAllTimersAsync();
  expect(await result).toBe(true); expect(request).toHaveBeenCalledTimes(2);
});
