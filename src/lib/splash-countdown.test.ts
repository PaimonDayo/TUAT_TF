import { describe, expect, it } from "vitest";
import { readSplashCache, reelCells, shouldShowSplash } from "./splash-countdown";

const cache = { name: "27大戦", startsOn: "2026-09-21", fetchedOn: "2026-09-10" };

describe("readSplashCache", () => {
  it("覚えた内容を読み戻す", () => {
    expect(readSplashCache(JSON.stringify(cache))).toEqual(cache);
  });

  it("壊れていたら覚えていない扱い", () => {
    expect(readSplashCache(null)).toBeNull();
    expect(readSplashCache("{")).toBeNull();
    expect(readSplashCache(JSON.stringify({ ...cache, startsOn: "9/21" }))).toBeNull();
    expect(readSplashCache(JSON.stringify({ name: "27大戦" }))).toBeNull();
  });
});

describe("shouldShowSplash", () => {
  const base = { cache, disabled: false, days: 11 };

  it("開くたびに出す", () => {
    expect(shouldShowSplash(base)).toBe(true);
    expect(shouldShowSplash(base)).toBe(true);
  });

  it("設定でスキップにしていれば出さない", () => {
    expect(shouldShowSplash({ ...base, disabled: true })).toBe(false);
  });

  it("まだ何も覚えていない初回は出さない", () => {
    expect(shouldShowSplash({ ...base, cache: null, days: null })).toBe(false);
  });

  it("当日は出す（あと0日）", () => {
    expect(shouldShowSplash({ ...base, days: 0 })).toBe(true);
  });

  it("大会が終わっていれば出さない", () => {
    expect(shouldShowSplash({ ...base, days: -1 })).toBe(false);
  });
});

describe("reelCells", () => {
  it("最後の周の該当数字で止まる", () => {
    const { cells, offset } = reelCells(3, 2);
    expect(offset).toBe(23);
    expect(cells).toHaveLength(24);
    expect(cells[offset]).toBe(3);
    expect(cells[0]).toBe(0);
  });

  it("回らない指定でもその数字で止まる", () => {
    const { cells, offset } = reelCells(7, 0);
    expect(offset).toBe(7);
    expect(cells[offset]).toBe(7);
  });
});
