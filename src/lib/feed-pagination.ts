export type FeedCursor = {
  record?: { createdAt: string; id: string };
  tweet?: { createdAt: string; id: string };
} | null;

/** Both sources share the displayed page's boundary, including absent kinds. */
export function nextFeedCursor(page: { created_at: string; id: string }[], size: number): FeedCursor | undefined {
  if (page.length < size) return undefined;
  const last = page.at(-1);
  if (!last) return undefined;
  const cursor = { createdAt: last.created_at, id: last.id };
  return { record: cursor, tweet: cursor };
}
