import { describe, expect, it, vi } from "vitest";
import { fetchAllPages } from "./fetch-all-pages";

/** 1回に最大 cap 件しか返さない窓口を模す（本番のPostgRESTは1,000件）。 */
function cappedSource(total: number, cap: number) {
  const all = Array.from({ length: total }, (_, i) => i);
  return vi.fn(async (from: number, to: number) => ({ data: all.slice(from, Math.min(to + 1, from + cap)), error: null }));
}

describe("fetchAllPages", () => {
  it("reads every row past the per-request cap", async () => {
    const source = cappedSource(2503, 1000);
    const rows = await fetchAllPages(source, 1000);
    expect(rows).toHaveLength(2503);
    expect(rows.at(-1)).toBe(2502);
    expect(source).toHaveBeenCalledTimes(3);
  });

  it("asks once more when the last page is exactly full", async () => {
    const source = cappedSource(2000, 1000);
    expect(await fetchAllPages(source, 1000)).toHaveLength(2000);
    expect(source).toHaveBeenCalledTimes(3);
  });

  it("stops on an error instead of returning a partial list", async () => {
    const source = vi.fn(async (from: number) =>
      from === 0 ? { data: Array(1000).fill(0), error: null } : { data: null, error: new Error("boom") });
    await expect(fetchAllPages(source, 1000)).rejects.toThrow("boom");
  });
});
