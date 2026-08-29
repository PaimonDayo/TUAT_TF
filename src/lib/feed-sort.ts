import type { FeedItem } from "@/types";

/**
 * 投稿（練習記録 + つぶやき）の並び順。新しい順で、created_at が同値なら id の降順で固定する。
 * スプレッドシート由来の記録は created_at が「練習日の0時(JST)」に揃うため同値が日常的に起きる。
 * タイブレークが無いと、同じ投稿群でも画面や再取得のたびに並びが変わってしまう。
 */
export function compareFeedItems(a: FeedItem, b: FeedItem): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return b.id.localeCompare(a.id);
}

/** 投稿（練習記録 + つぶやき）を新しい順に並べる */
export function sortFeedItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort(compareFeedItems);
}
