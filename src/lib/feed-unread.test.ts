import { describe, expect, it } from "vitest";
import { newestFeedTime, unreadBoundaryIndex } from "@/lib/feed-unread";
import type { FeedItem } from "@/types";

function tweet(createdAt: string): FeedItem {
  return { kind: "tweet", id: createdAt, created_at: createdAt } as unknown as FeedItem;
}

// 新しい順に並んだフィード（タイムラインと同じ並び）
const feed = [
  tweet("2026-08-29T10:00:00Z"),
  tweet("2026-08-29T09:00:00Z"),
  tweet("2026-08-28T20:00:00Z"),
];

describe("unreadBoundaryIndex", () => {
  it("最後に見た時刻より新しい投稿の直後に線を出す", () => {
    expect(unreadBoundaryIndex(feed, Date.parse("2026-08-29T09:30:00Z"))).toBe(1);
    expect(unreadBoundaryIndex(feed, Date.parse("2026-08-28T23:00:00Z"))).toBe(2);
  });

  it("初回（最後に見た時刻が無い）は線を出さない", () => {
    expect(unreadBoundaryIndex(feed, null)).toBe(-1);
  });

  it("新着が1件も無いときは線を出さない", () => {
    expect(unreadBoundaryIndex(feed, Date.parse("2026-08-29T12:00:00Z"))).toBe(-1);
  });

  it("読み込んだ範囲が全部新着のとき（境目が画面外）は線を出さない", () => {
    expect(unreadBoundaryIndex(feed, Date.parse("2026-08-20T00:00:00Z"))).toBe(-1);
  });

  it("投稿が無いときは線を出さない", () => {
    expect(unreadBoundaryIndex([], Date.parse("2026-08-29T00:00:00Z"))).toBe(-1);
  });
});

describe("newestFeedTime", () => {
  it("一番新しい投稿の時刻を返す", () => {
    expect(newestFeedTime(feed)).toBe(Date.parse("2026-08-29T10:00:00Z"));
  });

  it("投稿が無ければ null", () => {
    expect(newestFeedTime([])).toBeNull();
  });
});
