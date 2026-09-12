// タイムライン（練習記録 + つぶやき）の取得。

import { createClient } from "@/lib/supabase/server";
import { jstToday } from "@/lib/date";
import { normalizeRecordWithAuthor, normalizeTweetWithAuthor } from "@/lib/profile-normalize";
import { RECORD_NONEMPTY_OR } from "@/lib/record-content";
import type { FeedItem } from "@/types";
import { AUTHOR_SELECT, TWEET_AUTHOR_SELECT, attachTweetSocialData, SHEET_TIMELINE_OR, fetchFeedSocialState, fetchTargetSocialState } from "./internal";

/**
 * タイムライン用フィード（練習記録 + つぶやき）を取得し、
 * created_at の新しい順にマージして返す。block でフィルタ可能。
 */
export async function getFeed(
  currentUserId: string,
  limit = 30,
  cursors?: {
    record?: { createdAt: string; id: string };
    tweet?: { createdAt: string; id: string };
  },
): Promise<FeedItem[]> {
  const supabase = await createClient();

  let recordsQuery = supabase
    .from("practice_records")
    .select(`*, ${AUTHOR_SELECT}`)
    .lte("recorded_date", jstToday())
    .or(RECORD_NONEMPTY_OR)
    .or(SHEET_TIMELINE_OR)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  let tweetsQuery = supabase
    .from("tweets")
    .select(`*, ${TWEET_AUTHOR_SELECT}`)
    .order("created_at", { ascending: false })
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("id", { ascending: false })
    .limit(limit);

  if (cursors?.record) {
    const { createdAt, id } = cursors.record;
    recordsQuery = recordsQuery.or(
      `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`,
    );
  }
  if (cursors?.tweet) {
    const { createdAt, id } = cursors.tweet;
    tweetsQuery = tweetsQuery.or(
      `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`,
    );
  }

  const [recordsResult, tweetsResult] = await Promise.all([
    recordsQuery,
    tweetsQuery,
  ]);
  if (recordsResult.error) throw new Error(`Failed to load timeline records: ${recordsResult.error.message}`);
  if (tweetsResult.error) throw new Error(`Failed to load timeline posts: ${tweetsResult.error.message}`);
  const recRows = recordsResult.data;
  const twRows = tweetsResult.data;

  const records = (recRows ?? []).map(normalizeRecordWithAuthor);
  const tweets = await attachTweetSocialData(supabase, (twRows ?? []).map(normalizeTweetWithAuthor));

  const recIds = records.map((r) => r.id);
  const twIds = tweets.map((t) => t.id);

  // currentUserId remains part of this function's public contract/query key. The
  // RPC derives the authenticated viewer from auth.uid(), so it cannot be spoofed.
  void currentUserId;
  const social = await fetchFeedSocialState(supabase, recIds, twIds);

  const items: FeedItem[] = [
    ...records.map(
      (r): FeedItem => ({
        kind: "record",
        ...r,
        liked_by_me: social.liked.has(`record:${r.id}`),
        comments_count: social.comments.get(`record:${r.id}`) ?? 0,
      }),
    ),
    ...tweets.map(
      (t): FeedItem => ({
        kind: "tweet",
        ...t,
        liked_by_me: social.liked.has(`tweet:${t.id}`),
        comments_count: social.comments.get(`tweet:${t.id}`) ?? 0,
      }),
    ),
  ];

  items.sort((a, b) =>
    a.created_at === b.created_at
      ? b.id.localeCompare(a.id)
      : a.created_at < b.created_at ? 1 : -1,
  );
  return items.slice(0, limit);
}

/**
 * 通知からのパーマリンク用。単一の投稿を FeedItem と同じ形で取得する。
 * タイムライン表示用の間引き（未来日除外・空の記録の除外・SHEET_TIMELINE_CUTOFF）は
 * 一切かけない。古い投稿や空に近い記録に付いたコメント通知からも必ず開けるようにするため。
 * 閲覧できるかどうかは RLS（部員なら全件 SELECT 可）が担保する。
 */
export async function getFeedItemById(
  kind: "record" | "tweet",
  id: string,
  currentUserId: string,
): Promise<FeedItem | null> {
  const supabase = await createClient();

  // テーブル名を三項演算子で動的に組み立てると生成型の推論が壊れるため if で分ける。
  if (kind === "record") {
    const { data, error } = await supabase
      .from("practice_records")
      .select(`*, ${AUTHOR_SELECT}`)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Failed to load post: ${error.message}`);
    if (!data || !data.author) return null;

    void currentUserId;
    const { liked, comments } = await fetchTargetSocialState(supabase, "record", [id]);
    return {
      kind: "record",
      ...normalizeRecordWithAuthor(data),
      liked_by_me: liked.has(id),
      comments_count: comments.get(id) ?? 0,
    };
  }

  const { data, error } = await supabase
    .from("tweets")
    .select(`*, ${TWEET_AUTHOR_SELECT}`)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load post: ${error.message}`);
  if (!data || !data.author) return null;

  void currentUserId;
  const { liked, comments } = await fetchTargetSocialState(supabase, "tweet", [id]);
  const [tweet] = await attachTweetSocialData(supabase, [normalizeTweetWithAuthor(data)]);
  return {
    kind: "tweet",
    ...tweet,
    liked_by_me: liked.has(id),
    comments_count: comments.get(id) ?? 0,
  };
}
/**
 * あるユーザーのつぶやきを、いいね・コメント件数つきで取得する。
 * マイページと部員ページ（他人のプロフィール）で同じ内容を出すための共通経路。
 */
export async function getUserTweets(
  userId: string,
  currentUserId: string,
  limit = 50,
): Promise<FeedItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tweets")
    .select(`*, ${TWEET_AUTHOR_SELECT}`)
    .eq("user_id", userId)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Failed to load member posts: " + error.message);

  const tweets = await attachTweetSocialData(supabase, (data ?? []).map(normalizeTweetWithAuthor));
  const ids = tweets.map((tweet) => tweet.id);
  void currentUserId;
  const { liked, comments } = await fetchTargetSocialState(supabase, "tweet", ids);
  return tweets.map(
    (tweet): FeedItem => ({
      kind: "tweet",
      ...tweet,
      liked_by_me: liked.has(tweet.id),
      comments_count: comments.get(tweet.id) ?? 0,
    }),
  );
}

/** 投稿（練習記録 + つぶやき）を新しい順に並べる */
export function sortFeedItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) =>
    a.created_at === b.created_at
      ? b.id.localeCompare(a.id)
      : a.created_at < b.created_at ? 1 : -1,
  );
}

/** あるユーザーの投稿（練習記録 + つぶやき）をマージして返す（マイページ用） */
export async function getUserActivity(
  userId: string,
  currentUserId: string,
  limit = 50,
): Promise<FeedItem[]> {
  const supabase = await createClient();

  const [recordsResult, tweetItems] = await Promise.all([
    supabase
      .from("practice_records")
      .select(`*, ${AUTHOR_SELECT}`)
      .eq("user_id", userId)
      .lte("recorded_date", jstToday())
      .or(RECORD_NONEMPTY_OR)
      .or(SHEET_TIMELINE_OR)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit),
    getUserTweets(userId, currentUserId, limit),
  ]);
  if (recordsResult.error) throw new Error("Failed to load member records: " + recordsResult.error.message);

  const records = (recordsResult.data ?? []).map(normalizeRecordWithAuthor);
  const recIds = records.map((r) => r.id);
  void currentUserId;
  const { liked: recLiked, comments: recComments } = await fetchTargetSocialState(supabase, "record", recIds);

  return sortFeedItems([
    ...records.map(
      (r): FeedItem => ({
        kind: "record",
        ...r,
        liked_by_me: recLiked.has(r.id),
        comments_count: recComments.get(r.id) ?? 0,
      }),
    ),
    ...tweetItems,
  ]);
}
