import { describe, expect, it } from "vitest";
import {
  feedDateLabel,
  feedItemDate,
  groupFeedItemsByDate,
  uniqueFeedItems,
} from "./feed-date";
import type { FeedItem } from "@/types";

describe("feed date helpers", () => {
  it("uses the JST posting date for practice records, not the practice date", () => {
    const item = {
      kind: "record",
      recorded_date: "2026-07-23",
      created_at: "2026-07-24T03:00:00.000Z",
    } as FeedItem;

    expect(feedItemDate(item)).toBe("2026-07-24");
  });

  it("groups tweets by JST date", () => {
    const item = {
      kind: "tweet",
      created_at: "2026-07-23T16:30:00.000Z",
    } as FeedItem;

    expect(feedItemDate(item)).toBe("2026-07-24");
  });

  it("labels today, yesterday, and older dates", () => {
    expect(feedDateLabel("2026-07-24", "2026-07-24", "2026-07-23")).toBe("今日");
    expect(feedDateLabel("2026-07-23", "2026-07-24", "2026-07-23")).toBe("昨日");
    expect(feedDateLabel("2026-07-20", "2026-07-24", "2026-07-23")).toBe("7月20日");
  });

  it("keeps a late-entered practice record in its posting-day group", () => {
    const lateYesterdayPractice = {
      kind: "record",
      id: "late-yesterday",
      recorded_date: "2026-07-25",
      created_at: "2026-07-26T08:00:00.000Z",
    } as FeedItem;
    const todayPost = {
      kind: "tweet",
      id: "today",
      created_at: "2026-07-26T07:00:00.000Z",
    } as FeedItem;
    const yesterdayPost = {
      kind: "record",
      id: "earlier-yesterday",
      recorded_date: "2026-07-25",
      created_at: "2026-07-25T07:00:00.000Z",
    } as FeedItem;

    expect(groupFeedItemsByDate([
      lateYesterdayPractice,
      todayPost,
      yesterdayPost,
    ])).toEqual([
      { date: "2026-07-26", items: [lateYesterdayPractice, todayPost] },
      { date: "2026-07-25", items: [yesterdayPost] },
    ]);
  });

  it("removes duplicate feed entries without mixing record and tweet ids", () => {
    const record = { kind: "record", id: "same" } as FeedItem;
    const tweet = { kind: "tweet", id: "same" } as FeedItem;

    expect(uniqueFeedItems([record, record, tweet])).toEqual([record, tweet]);
  });
});
