import type { FeedItem } from "@/types";

const JST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function feedItemDate(item: FeedItem): string {
  return item.kind === "record"
    ? item.recorded_date
    : JST_DATE_FORMATTER.format(new Date(item.created_at));
}

export function feedDateLabel(date: string, today: string, yesterday: string): string {
  if (date === today) return "今日";
  if (date === yesterday) return "昨日";
  const [, month, day] = date.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

export function uniqueFeedItems(items: readonly FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function groupFeedItemsByDate(items: readonly FeedItem[]): {
  date: string;
  items: FeedItem[];
}[] {
  const groups = new Map<string, FeedItem[]>();

  for (const item of items) {
    const date = feedItemDate(item);
    const group = groups.get(date);
    if (group) group.push(item);
    else groups.set(date, [item]);
  }

  return Array.from(groups, ([date, groupedItems]) => ({
    date,
    items: groupedItems,
  })).sort((a, b) => b.date.localeCompare(a.date));
}
