import { describe, expect, it } from "vitest";
import { nextFeedCursor } from "./feed-pagination";

describe("merged feed pagination", () => {
  it("never re-reads an absent kind across consecutive pages", () => {
    const source = Array.from({ length: 91 }, (_, i) => ({ id: String(1000 - i), created_at: new Date(2026, 0, 1, 0, 0, 100 - i).toISOString(), kind: i === 0 ? "tweet" : "record" }));
    const seen: string[] = [];
    let cursor = null as ReturnType<typeof nextFeedCursor>;
    for (let i = 0; i < 4; i++) {
      const page = source.filter((row) => {
        const boundary = row.kind === "tweet" ? cursor?.tweet : cursor?.record;
        return !boundary || row.created_at < boundary.createdAt || row.created_at === boundary.createdAt && row.id < boundary.id;
      }).slice(0, 30);
      seen.push(...page.map((r) => r.id));
      cursor = nextFeedCursor(page, 30);
    }
    expect(seen).toEqual(source.map((r) => r.id));
  });
  it("uses the ID as a tie breaker and stops at a short page", () => {
    expect(nextFeedCursor([{ created_at: "2026-09-28", id: "b" }, { created_at: "2026-09-28", id: "a" }], 2)).toEqual({ record: { createdAt: "2026-09-28", id: "a" }, tweet: { createdAt: "2026-09-28", id: "a" } });
    expect(nextFeedCursor([], 30)).toBeUndefined();
  });
});
