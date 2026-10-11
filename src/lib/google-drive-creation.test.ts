import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createScheduleSpreadsheet, scheduleSpreadsheetFingerprint, type ScheduleSpreadsheetInput } from "./google-drive";
vi.mock("./pc-backup-status", () => ({ assertPcAppWriteAllowed: async () => undefined }));
const input = { accessToken: "synthetic-token", title: "synthetic", kind: "practice" as const, block: "all" as const,
  year: 2026, month: 11, venues: [], schedules: [], weekdayDefaults: [], onCreated: async () => undefined };
const provider = vi.fn<typeof fetch>();
beforeEach(() => { provider.mockReset().mockImplementation(async () => Response.json({ spreadsheetId: "synthetic-book", sheets: [{ properties: { sheetId: 7 } }] })); vi.stubGlobal("fetch", provider); });
afterEach(() => vi.unstubAllGlobals());
it("requires durable ID storage before dispatch and stops formatting if storage fails", async () => {
  await expect(createScheduleSpreadsheet({ ...input, onCreated: undefined } as unknown as ScheduleSpreadsheetInput)).rejects.toThrow("receipt");
  expect(provider).not.toHaveBeenCalled();
  const persist = vi.fn().mockRejectedValue(new Error("synthetic persistence unavailable"));
  await expect(createScheduleSpreadsheet({ ...input, onCreated: persist })).rejects.toMatchObject({ phase: "record", resource: { spreadsheetId: "synthetic-book" }, retryable: false });
  expect(provider).toHaveBeenCalledOnce(); expect(persist).toHaveBeenCalledOnce();
});
it("binds actual creation/setup input while ignoring normal access token refresh", () => {
  const refreshed = { ...input, accessToken: "rotated-synthetic-token" };
  expect(scheduleSpreadsheetFingerprint(input)).toBe(scheduleSpreadsheetFingerprint(refreshed));
  for (const change of [{ title: "other" }, { month: 12 }, { weekdayDefaults: [{ weekday: 1, time: "10:00", venueName: "synthetic" }] }]) {
    expect(scheduleSpreadsheetFingerprint({ ...input, ...change })).not.toBe(scheduleSpreadsheetFingerprint(input));
  }
});
