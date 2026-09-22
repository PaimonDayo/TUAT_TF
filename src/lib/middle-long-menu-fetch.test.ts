import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tabs = 'items.push({name:"9月メニュー",gid:"9"});items.push({name:"10月メニュー",gid:"10"});';
const csv = "9/22,火,17:00,競技場,ジョグ,,,";
beforeEach(() => { vi.resetModules(); vi.stubEnv("SHEET_SYNC_SPREADSHEET_ID", "test-sheet"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("shared in-flight Google menu reads", () => {
  it("collapses ten simultaneous readers to one metadata and one CSV request", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(url.includes("htmlview") ? tabs : csv));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMiddleLongMenuSnapshot: read } = await import("./middle-long-menu-sheet");
    const snapshots = await Promise.all(Array.from({ length: 10 }, () => read([9])));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(snapshots.every(snapshot => snapshot.loadedMonths.join() === "9")).toBe(true);
    expect(snapshots[0].rows[0].content).toBe("ジョグ");
    await read([9]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("fetches new content after the existing 60 second freshness window", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => new Response(url.includes("htmlview") ? tabs : csv));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMiddleLongMenuSnapshot: read } = await import("./middle-long-menu-sheet");
    await read([9]);
    await vi.advanceTimersByTimeAsync(60_001);
    await Promise.all([read([9]), read([9])]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("does not mix different spreadsheets or months", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(url.includes("htmlview") ? tabs : csv));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMiddleLongMenuSnapshot: read } = await import("./middle-long-menu-sheet");
    const first = read([9, 10]);
    vi.stubEnv("SHEET_SYNC_SPREADSHEET_ID", "another-sheet");
    const second = read([9]);
    const result = await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.map(snapshot => snapshot.loadedMonths)).toEqual([[9, 10], [9]]);
  });
  it("shares a failed CSV attempt without marking the month loaded and retries next time", async () => {
    let failed = true;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("htmlview")) return new Response(tabs);
      return failed ? new Response("unavailable", { status: 503 }) : new Response(csv);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMiddleLongMenuSnapshot: read } = await import("./middle-long-menu-sheet");
    const snapshots = await Promise.all([read([9]), read([9])]);
    expect(snapshots.every(snapshot => snapshot.loadedMonths.length === 0)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    failed = false;
    expect((await read([9])).loadedMonths).toEqual([9]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("releases a failed metadata request so it does not poison later reads", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (url: string) => new Response(url.includes("htmlview") ? tabs : csv));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMiddleLongMenuSnapshot: read } = await import("./middle-long-menu-sheet");
    await Promise.all([read([9]), read([9])]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await read([9])).loadedMonths).toEqual([9]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
