import type { FeedItem } from "@/types";

/** 未読ラインの基準になる時刻。フィードの並び順（created_at）と同じものを使う。 */
export function feedItemTime(item: FeedItem): number {
  return new Date(item.created_at).getTime();
}

/** 表示中で一番新しい投稿の時刻。次回の「ここまで読んだ」に保存する値。 */
export function newestFeedTime(items: readonly FeedItem[]): number | null {
  let newest: number | null = null;
  for (const item of items) {
    const time = feedItemTime(item);
    if (Number.isNaN(time)) continue;
    if (newest === null || time > newest) newest = time;
  }
  return newest;
}

/**
 * 「ここまで読みました」の線を出す位置（この番号の投稿の直前に出す）。線を出さないときは -1。
 * 新着が1件も無いとき（先頭が既読）と、読み込んだ範囲が全部新着のとき（＝境目が画面外）は出さない。
 */
export function unreadBoundaryIndex(
  items: readonly FeedItem[],
  lastSeenAt: number | null,
): number {
  if (lastSeenAt === null) return -1;
  const index = items.findIndex((item) => feedItemTime(item) <= lastSeenAt);
  return index <= 0 ? -1 : index;
}
