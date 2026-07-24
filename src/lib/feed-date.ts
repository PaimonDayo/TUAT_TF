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
