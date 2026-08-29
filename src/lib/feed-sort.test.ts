import { describe, expect, it } from "vitest";
import { compareFeedItems, sortFeedItems } from "@/lib/feed-sort";
import type { FeedItem } from "@/types";

function item(id: string, createdAt: string): FeedItem {
  return { kind: "tweet", id, created_at: createdAt } as unknown as FeedItem;
}

describe("sortFeedItems", () => {
  it("新しい順に並べる", () => {
    const sorted = sortFeedItems([
      item("a", "2026-08-01T00:00:00+09:00"),
      item("b", "2026-08-03T00:00:00+09:00"),
      item("c", "2026-08-02T00:00:00+09:00"),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["b", "c", "a"]);
  });

  // スプレッドシート由来の記録は created_at が練習日の0時に揃うため、
  // 同値のタイブレークが無いと画面ごとに並びが変わってしまう。
  it("created_at が同値なら id の降順で固定する", () => {
    const sameDay = "2026-08-01T00:00:00+09:00";
    const sorted = sortFeedItems([item("a", sameDay), item("c", sameDay), item("b", sameDay)]);
    expect(sorted.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
  });

  it("入力の配列を破壊しない", () => {
    const input = [item("a", "2026-08-01T00:00:00+09:00"), item("b", "2026-08-02T00:00:00+09:00")];
    sortFeedItems(input);
    expect(input.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("同一の投稿は 0 を返す", () => {
    const same = item("a", "2026-08-01T00:00:00+09:00");
    expect(compareFeedItems(same, same)).toBe(0);
  });
});
