import { describe, expect, it } from "vitest";
import { feedDateLabel, feedItemDate } from "./feed-date";
import type { FeedItem } from "@/types";

describe("feed date helpers", () => {
  it("uses recorded_date for practice records", () => {
    const item = {
      kind: "record",
      recorded_date: "2026-07-24",
      created_at: "2026-07-23T15:00:00.000Z",
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
});
