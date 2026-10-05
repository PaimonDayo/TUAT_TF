import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  records: vi.fn(), tweets: vi.fn(), social: vi.fn(), quoted: vi.fn(), targetSocial: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => {
  // Apply predicates to the table before sorting/limiting, as PostgREST does.
  // This fixture exposes missing DB filters that an unconditional query stub hid.
  function clauses(expression: string): string[] {
    let depth = 0;
    let start = 0;
    const result: string[] = [];
    for (let index = 0; index < expression.length; index++) {
      if (expression[index] === "(") depth++;
      if (expression[index] === ")") depth--;
      if (expression[index] === "," && depth === 0) {
        result.push(expression.slice(start, index));
        start = index + 1;
      }
    }
    return [...result, expression.slice(start)];
  }
  function matches(row: Record<string, unknown>, expression: string): boolean {
    if (expression.startsWith("and(")) {
      return clauses(expression.slice(4, -1)).every((part) => matches(row, part));
    }
    const [, column, operator, raw] = /^([^.]+)\.(eq|lt|lte|gte|gt|is)\.(.*)$/.exec(expression) ?? [];
    if (!column) throw new Error(`Unsupported test predicate: ${expression}`);
    const actual = row[column];
    const expected = raw === "true" ? true : raw === "false" ? false : raw === "null" ? null : raw;
    if (operator === "eq" || operator === "is") return actual === expected;
    if (typeof actual !== "string" || typeof expected !== "string") return false;
    if (operator === "lt") return actual < expected;
    if (operator === "lte") return actual <= expected;
    if (operator === "gte") return actual >= expected;
    return actual > expected;
  }
  return { createClient: async () => ({ from(table: string) {
    const predicates: ((row: Record<string, unknown>) => boolean)[] = [];
    const orders: { column: string; ascending: boolean }[] = [];
    let limit = Infinity;
    let single = false;
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { predicates.push((row) => row[column] === value); return query; },
      lte: (column: string, value: string) => { predicates.push((row) => matches(row, `${column}.lte.${value}`)); return query; },
      or: (expression: string) => { predicates.push((row) => clauses(expression).some((part) => matches(row, part))); return query; },
      order: (column: string, options: { ascending: boolean }) => { orders.push({ column, ascending: options.ascending }); return query; },
      limit: (value: number) => { limit = value; return query; },
      maybeSingle: () => { single = true; return query; },
      then: (resolve: (result: unknown) => void) => {
        const rows = (mocks.rows[table] ?? []).filter((row) => predicates.every((predicate) => predicate(row)));
        rows.sort((left, right) => {
          for (const order of orders) {
            const a = String(left[order.column]);
            const b = String(right[order.column]);
            if (a !== b) return (a < b ? -1 : 1) * (order.ascending ? 1 : -1);
          }
          return 0;
        });
        const selected = rows.slice(0, limit);
        resolve({ data: single ? selected[0] ?? null : selected, error: null });
      },
    };
    return query;
  } }) };
});
vi.mock("@/lib/profile-normalize", () => ({ normalizeRecordWithAuthor: (row: unknown) => row, normalizeTweetWithAuthor: (row: unknown) => row }));
vi.mock("./internal", () => ({
  RECORD_LIST_SELECT: "*", RECORD_LIST_AUTHOR_SELECT: "", AUTHOR_SELECT: "", TWEET_AUTHOR_SELECT: "",
  SHEET_TIMELINE_OR: "from_sheet.eq.false,and(from_sheet.eq.true,recorded_date.gte.2026-07-04)",
  attachRecordFieldGroups: mocks.records, attachTweetSocialData: mocks.tweets, fetchFeedSocialState: mocks.social, fetchQuotedPosts: mocks.quoted,
  fetchTargetSocialState: mocks.targetSocial, withQuotedPost: (row: unknown) => row,
}));

import { getFeed, getFeedItemById, getUserActivity } from "./feed";

function record(id: string, date: string, fromSheet: boolean, createdAt: string) {
  return {
    id, user_id: "owner", author: { id: "owner" }, created_at: createdAt,
    recorded_date: date, from_sheet: fromSheet, record_has_content: true, likes_count: 5,
    custom: { note: "retained content" },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T15:00:05.000Z")); // 10/6 00:00 JST
  mocks.rows = Object.fromEntries(["practice_records", "tweets"].map((table) => [table,
    Array.from({ length: 30 }, (_, index) => ({
      ...record(`${table}-${index}`, "2026-10-05", false, new Date(Date.UTC(2026, 8, 28, 0, 0, 100 - index * 2 - (table === "tweets" ? 1 : 0))).toISOString()),
      expires_at: null,
    })),
  ]));
  mocks.records.mockImplementation(async (_, rows) => rows);
  mocks.tweets.mockImplementation(async (_, rows) => rows);
  mocks.social.mockResolvedValue({ liked: new Set(["record:app-today"]), comments: new Map([["record:app-today", 2]]) });
  mocks.targetSocial.mockResolvedValue({ liked: new Set(["app-today"]), comments: new Map([["app-today", 2]]) });
  mocks.quoted.mockResolvedValue(new Map());
});
afterEach(() => { vi.useRealTimers(); });

it("only enriches the merged 30 visible rows from 60 candidates", async () => {
  const page = await getFeed("viewer", 30);
  expect(page).toHaveLength(30);
  expect(mocks.records.mock.calls[0][1]).toHaveLength(15);
  expect(mocks.tweets.mock.calls[0][1]).toHaveLength(15);
  expect(mocks.social.mock.calls[0][1]).toHaveLength(15);
  expect(mocks.social.mock.calls[0][2]).toHaveLength(15);
  expect(mocks.quoted.mock.calls[0][1]).toHaveLength(15);
  expect(page.at(-1)?.id).toBe("tweets-14");
});

it.each([
  ["timeline", () => getFeed("viewer", 2)],
  ["member activity", () => getUserActivity("owner", "viewer", 2)],
] as const)("%s publishes today's app entry and yesterday's sheet entry before the page limit", async (_, load) => {
  mocks.rows.practice_records = [
    record("sheet-future", "2026-10-07", true, "2026-10-05T15:00:04.000Z"),
    record("sheet-today", "2026-10-06", true, "2026-10-05T15:00:03.000Z"),
    record("app-future", "2026-10-07", false, "2026-10-05T15:00:02.000Z"),
    record("app-today", "2026-10-06", false, "2026-10-05T15:00:01.000Z"),
    record("sheet-yesterday", "2026-10-05", true, "2026-10-05T15:00:00.000Z"),
    record("sheet-old-cutoff", "2026-07-03", true, "2026-10-05T14:59:59.000Z"),
  ];
  mocks.rows.tweets = [];
  const page = await load();
  expect(page.map((item) => item.id)).toEqual(["app-today", "sheet-yesterday"]);
  expect(page[0]).toMatchObject({ likes_count: 5, liked_by_me: true, comments_count: 2, custom: { note: "retained content" } });
  expect(mocks.rows.practice_records).toHaveLength(6);
});

it("keeps page cursors on published entries when newer current-day sheet placeholders exist", async () => {
  mocks.rows.practice_records = [
    ...Array.from({ length: 35 }, (_, index) => record(`planned-${index}`, "2026-10-06", true, "2026-10-05T15:00:04.000Z")),
    record("app-today", "2026-10-06", false, "2026-10-05T15:00:03.000Z"),
    record("sheet-yesterday", "2026-10-05", true, "2026-10-05T15:00:02.000Z"),
    record("sheet-older", "2026-10-04", true, "2026-10-05T15:00:01.000Z"),
  ];
  mocks.rows.tweets = [];
  const first = await getFeed("viewer", 2);
  expect(first.map((item) => item.id)).toEqual(["app-today", "sheet-yesterday"]);
  const boundary = { createdAt: first[1].created_at, id: first[1].id };
  const next = await getFeed("viewer", 2, { record: boundary, tweet: boundary });
  expect(next.map((item) => item.id)).toEqual(["sheet-older"]);
});

it("keeps a current-day sheet record accessible by its notification permalink", async () => {
  mocks.rows.practice_records = [record("sheet-today", "2026-10-06", true, "2026-10-05T15:00:03.000Z")];
  const item = await getFeedItemById("record", "sheet-today", "viewer");
  expect(item).toMatchObject({ id: "sheet-today", likes_count: 5, recorded_date: "2026-10-06" });
});
