import { describe, expect, it } from "vitest";
import {
  noticeContentSnippet,
  noticeMatchesFilters,
  noticeMatchesSearch,
  noticeSearchTokens,
} from "@/lib/notice-filters";
import type { NoticeWithReactions } from "@/types";

const notice: NoticeWithReactions = {
  id: "notice-1",
  author_id: "user-1",
  category: "entry",
  title: "三大戦の出席調査およびエントリー",
  content: "B3以下は回答必須です。フォームから回答してください。",
  deadline: "2026-07-30",
  pin_home: false,
  notify_members: true,
  target_role_ids: [],
  mentioned_all: true,
  mentioned_role_ids: [],
  mentioned_user_ids: [],
  mentioned_blocks: [],
  mentioned_grades: [],
  created_at: "2026-07-20T00:00:00Z",
  reaction_counts: { ack: 1, thanks: 0, question: 0 },
  my_reactions: [],
};

describe("notice filters", () => {
  it("matches whitespace-separated terms even when they are not contiguous", () => {
    expect(noticeMatchesSearch(notice, noticeSearchTokens("三大戦 エントリー"))).toBe(true);
  });

  it("normalizes full-width latin characters", () => {
    expect(noticeMatchesSearch(notice, noticeSearchTokens("Ｂ３"))).toBe(true);
  });

  it("filters by category, deadline, and acknowledgement", () => {
    expect(noticeMatchesFilters(notice, {
      categories: ["entry"],
      deadline: "open",
      acknowledgement: "unacknowledged",
    }, "2026-07-22")).toBe(true);
    expect(noticeMatchesFilters(notice, {
      categories: ["fee"],
      deadline: "all",
      acknowledgement: "all",
    }, "2026-07-22")).toBe(false);
  });

  it("returns context when a match exists only in the body", () => {
    expect(noticeContentSnippet(notice, noticeSearchTokens("回答必須"))).toContain("回答必須");
  });
});
