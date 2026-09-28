import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ records: vi.fn(), tweets: vi.fn(), social: vi.fn(), quoted: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  const data = Array.from({ length: 30 }, (_, i) => ({ id: `${table}-${i}`, created_at: new Date(Date.UTC(2026, 8, 28, 0, 0, 100 - i * 2 - (table === "tweets" ? 1 : 0))).toISOString() }));
  const q = new Proxy({}, { get: (_, key) => key === "then" ? (resolve: (r: unknown) => void) => resolve({ data, error: null }) : () => q });
  return q;
} }) }));
vi.mock("@/lib/profile-normalize", () => ({ normalizeRecordWithAuthor: (r: unknown) => r, normalizeTweetWithAuthor: (r: unknown) => r }));
vi.mock("./internal", () => ({
  RECORD_LIST_SELECT: "*", RECORD_LIST_AUTHOR_SELECT: "", AUTHOR_SELECT: "", TWEET_AUTHOR_SELECT: "", SHEET_TIMELINE_OR: "",
  attachRecordFieldGroups: mocks.records, attachTweetSocialData: mocks.tweets, fetchFeedSocialState: mocks.social, fetchQuotedPosts: mocks.quoted,
  fetchTargetSocialState: vi.fn(), withQuotedPost: (r: unknown) => r,
}));
import { getFeed } from "./feed";
it("only enriches the merged 30 visible rows from 60 candidates", async () => {
  mocks.records.mockImplementation(async (_, rows) => rows);mocks.tweets.mockImplementation(async (_, rows) => rows);
  mocks.social.mockResolvedValue({ liked: new Set(), comments: new Map() });mocks.quoted.mockResolvedValue(new Map());
  const page = await getFeed("viewer", 30);
  expect(page).toHaveLength(30);
  expect(mocks.records.mock.calls[0][1]).toHaveLength(15);
  expect(mocks.tweets.mock.calls[0][1]).toHaveLength(15);
  expect(mocks.social.mock.calls[0][1]).toHaveLength(15);
  expect(mocks.social.mock.calls[0][2]).toHaveLength(15);
  expect(mocks.quoted.mock.calls[0][1]).toHaveLength(15);
  expect(page.at(-1)?.id).toBe("tweets-14");
});
