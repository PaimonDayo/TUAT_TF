// queries/ 内だけで共有する select 文とソーシャル情報の付与処理。
// アプリ側からは @/lib/queries を使う（このモジュールは公開しない）。

import { createClient } from "@/lib/supabase/server";
import type { Notice, NoticeReaction, NoticeWithReactions, TweetWithAuthor } from "@/types";

export const AUTHOR_SELECT = "author:profiles!user_id(id, display_name, avatar_url, blocks, grade, record_source, record_fields)";
// Tweets never render practice-record fields. Avoid repeating every author's
// form configuration in each tweet; records still use AUTHOR_SELECT above.
export const TWEET_AUTHOR_SELECT = "author:profiles!user_id(id, display_name, avatar_url, blocks, grade)";
export async function attachTweetSocialData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tweets: TweetWithAuthor[],
): Promise<TweetWithAuthor[]> {
  const tweetIds = tweets.map((tweet) => tweet.id);
  if (tweetIds.length === 0) return tweets;

  const { data, error } = await supabase.rpc("get_tweet_feed_extras", { tweet_ids: tweetIds });
  if (error) throw new Error(`Failed to load poll data: ${error.message}`);
  const extras = new Map((data ?? []).map((row) => [row.tweet_id, row]));

  return tweets.map((tweet) => {
    const extra = extras.get(tweet.id);
    const pollOptions = Array.isArray(extra?.options)
      ? extra.options as unknown as NonNullable<TweetWithAuthor["poll"]>["options"]
      : [];
    const mentions = Array.isArray(extra?.mentions)
      ? extra.mentions as unknown as NonNullable<TweetWithAuthor["mentions"]>
      : [];
    return {
      ...tweet,
      poll: pollOptions.length ? { options: pollOptions } : undefined,
      mentions,
    };
  });
}
export const NOTICE_REACTIONS: NoticeReaction[] = ["ack", "thanks", "question"];
export function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

// 練習記録の表示フィルタ。
// タイムライン等のソーシャル表示は「未来日除外・中身あり」。
// スプシ由来(from_sheet=true)の記録もタイムラインに表示するが、連携直後に古い記録が
// 一気に流れ込んで埋まらないよう、この機能を入れた日以降の recorded_date だけ対象にする。
export const SHEET_TIMELINE_CUTOFF = "2026-07-04";
export const SHEET_TIMELINE_OR = `from_sheet.eq.false,and(from_sheet.eq.true,recorded_date.gte.${SHEET_TIMELINE_CUTOFF})`;
export async function withNoticeReactions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  notices: Notice[],
  userId: string,
): Promise<NoticeWithReactions[]> {
  const ids = notices.map((notice) => notice.id);
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("notice_reactions")
    .select("notice_id, user_id, reaction")
    .in("notice_id", ids);

  const counts = new Map<string, Record<NoticeReaction, number>>();
  const mine = new Map<string, NoticeReaction[]>();
  for (const id of ids) {
    counts.set(id, { ack: 0, thanks: 0, question: 0 });
    mine.set(id, []);
  }
  for (const row of data ?? []) {
    const reaction = row.reaction as NoticeReaction;
    if (!NOTICE_REACTIONS.includes(reaction)) continue;
    const noticeCounts = counts.get(row.notice_id as string);
    if (noticeCounts) noticeCounts[reaction] += 1;
    if (row.user_id === userId) {
      mine.get(row.notice_id as string)?.push(reaction);
    }
  }

  return notices.map((notice) => ({
    ...notice,
    reaction_counts: counts.get(notice.id) ?? { ack: 0, thanks: 0, question: 0 },
    my_reactions: mine.get(notice.id) ?? [],
  }));
}

export type FeedSocialState = {
  liked: Set<string>;
  comments: Map<string, number>;
};

/** 自分のいいね状態とコメント件数を、投稿種別をまたいで1 RPCで取得する。 */
export async function fetchFeedSocialState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  recordIds: string[],
  tweetIds: string[],
): Promise<FeedSocialState> {
  const liked = new Set<string>();
  const comments = new Map<string, number>();
  if (recordIds.length === 0 && tweetIds.length === 0) return { liked, comments };
  const { data, error } = await supabase.rpc("get_feed_social_state", {
    record_ids: recordIds,
    tweet_ids: tweetIds,
  });
  if (error) throw new Error(`Failed to load social state: ${error.message}`);
  for (const row of data ?? []) {
    const key = `${row.target_type}:${row.target_id}`;
    if (row.liked_by_me) liked.add(key);
    comments.set(key, Number(row.comments_count));
  }
  return { liked, comments };
}

export async function fetchTargetSocialState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  type: "record" | "tweet",
  ids: string[],
): Promise<{ liked: Set<string>; comments: Map<string, number> }> {
  const state = await fetchFeedSocialState(
    supabase,
    type === "record" ? ids : [],
    type === "tweet" ? ids : [],
  );
  return {
    liked: new Set(ids.filter((id) => state.liked.has(`${type}:${id}`))),
    comments: new Map(ids.map((id) => [id, state.comments.get(`${type}:${id}`) ?? 0])),
  };
}

