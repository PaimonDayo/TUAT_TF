// queries/ 内だけで共有する select 文とソーシャル情報の付与処理。
// アプリ側からは @/lib/queries を使う（このモジュールは公開しない）。

import { createClient } from "@/lib/supabase/server";
import { normalizeAuthorRow } from "@/lib/profile-normalize";
import { recordSummaryText } from "@/lib/post-summary";
import { displayedDistance } from "@/lib/record-distance";
import type { Notice, NoticeReaction, NoticeWithReactions, QuotedPost, QuotedPostKind, TweetWithAuthor } from "@/types";

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
/**
 * 引用元（練習記録・つぶやき）を、引用した投稿1件ぶんの小さな形で取ってくる。
 *
 * 引用元は外部キーではないので、消えていれば kind:"missing" を返して
 * 「削除されました」と出せるようにする。呼び出し側は、いいね件数などの取得と
 * 同時に投げられるよう Map で受け取る（DBへの往復を直列に積まない）。
 */
export async function fetchQuotedPosts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tweets: { quoted_type?: string | null; quoted_id?: string | null }[],
): Promise<Map<string, QuotedPost>> {
  const recordIds = new Set<string>();
  const tweetIds = new Set<string>();
  for (const tweet of tweets) {
    if (!tweet.quoted_id) continue;
    if (tweet.quoted_type === "record") recordIds.add(tweet.quoted_id);
    if (tweet.quoted_type === "tweet") tweetIds.add(tweet.quoted_id);
  }
  const found = new Map<string, QuotedPost>();
  if (recordIds.size === 0 && tweetIds.size === 0) return found;

  const [recordRows, tweetRows] = await Promise.all([
    recordIds.size > 0
      ? supabase
          .from("practice_records")
          .select(
            `id, created_at, recorded_date, dist_low, dist_mid, dist_high, dist_speed, dist_actual, menu_text, result_text, memo, focus_text, strength_text, custom, ${TWEET_AUTHOR_SELECT}`,
          )
          .in("id", [...recordIds])
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
    tweetIds.size > 0
      ? supabase
          .from("tweets")
          .select(`id, created_at, content, image_path, ${TWEET_AUTHOR_SELECT}`)
          .in("id", [...tweetIds])
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
  ]);

  for (const row of recordRows) {
    if (!row.author) continue;
    found.set(quotedPostKey("record", row.id), {
      kind: "record",
      id: row.id,
      author: normalizeAuthorRow(row.author),
      created_at: row.created_at,
      recorded_date: row.recorded_date,
      distanceKm: displayedDistance({
        dist_low: row.dist_low ?? 0,
        dist_mid: row.dist_mid ?? 0,
        dist_high: row.dist_high ?? 0,
        dist_speed: row.dist_speed ?? 0,
        dist_actual: row.dist_actual ?? 0,
      }),
      summary: recordSummaryText(row),
    });
  }
  for (const row of tweetRows) {
    if (!row.author) continue;
    found.set(quotedPostKey("tweet", row.id), {
      kind: "tweet",
      id: row.id,
      author: normalizeAuthorRow(row.author),
      created_at: row.created_at,
      content: row.content,
      hasImage: row.image_path !== null,
    });
  }
  return found;
}

export function quotedPostKey(kind: QuotedPostKind, id: string): string {
  return `${kind}:${id}`;
}

/** 引用元をつぶやきに載せる。引用しているのに見つからなければ削除済みとして扱う。 */
export function withQuotedPost<T extends TweetWithAuthor>(
  tweet: T,
  quoted: Map<string, QuotedPost>,
): T {
  if (!tweet.quoted_id || !tweet.quoted_type) return tweet;
  return {
    ...tweet,
    quoted: quoted.get(quotedPostKey(tweet.quoted_type, tweet.quoted_id))
      ?? { kind: "missing", id: tweet.quoted_id },
  };
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

