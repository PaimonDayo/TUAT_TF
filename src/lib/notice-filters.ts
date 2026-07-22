import type { NoticeCategory, NoticeWithReactions } from "@/types";

export type NoticeDeadlineFilter = "all" | "open" | "ended" | "none";
export type NoticeAcknowledgementFilter = "all" | "unacknowledged" | "acknowledged";

export interface NoticeFilters {
  categories: NoticeCategory[];
  deadline: NoticeDeadlineFilter;
  acknowledgement: NoticeAcknowledgementFilter;
}

export const EMPTY_NOTICE_FILTERS: NoticeFilters = {
  categories: [],
  deadline: "all",
  acknowledgement: "all",
};

export function normalizeNoticeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja");
}

export function noticeSearchTokens(query: string): string[] {
  return [...new Set(normalizeNoticeSearchText(query).trim().split(/\s+/).filter(Boolean))];
}

export function noticeMatchesSearch(notice: NoticeWithReactions, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = normalizeNoticeSearchText(`${notice.title}\n${notice.content}`);
  return tokens.every((token) => haystack.includes(token));
}

export function noticeMatchesFilters(
  notice: NoticeWithReactions,
  filters: NoticeFilters,
  today: string,
): boolean {
  if (filters.categories.length > 0 && !filters.categories.includes(notice.category)) return false;
  if (filters.deadline === "open" && (!notice.deadline || notice.deadline < today)) return false;
  if (filters.deadline === "ended" && (!notice.deadline || notice.deadline >= today)) return false;
  if (filters.deadline === "none" && notice.deadline) return false;

  const acknowledged = notice.my_reactions.includes("ack");
  if (filters.acknowledgement === "acknowledged" && !acknowledged) return false;
  if (filters.acknowledgement === "unacknowledged" && acknowledged) return false;
  return true;
}

export function noticeFilterCount(filters: NoticeFilters): number {
  return filters.categories.length
    + (filters.deadline === "all" ? 0 : 1)
    + (filters.acknowledgement === "all" ? 0 : 1);
}

export function noticeContentSnippet(notice: NoticeWithReactions, tokens: string[]): string | null {
  if (tokens.length === 0) return null;
  const title = normalizeNoticeSearchText(notice.title);
  const displayContent = notice.content.normalize("NFKC").replace(/\s+/g, " ").trim();
  const normalizedContent = displayContent.toLocaleLowerCase("ja");
  const contentOnlyToken = tokens.find((token) => !title.includes(token) && normalizedContent.includes(token));
  if (!contentOnlyToken) return null;

  const matchIndex = normalizedContent.indexOf(contentOnlyToken);
  const start = Math.max(0, matchIndex - 24);
  const end = Math.min(displayContent.length, matchIndex + contentOnlyToken.length + 48);
  return `${start > 0 ? "…" : ""}${displayContent.slice(start, end)}${end < displayContent.length ? "…" : ""}`;
}
