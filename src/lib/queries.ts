import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import type {
  FeedItem,
  RecordWithAuthor,
  TweetWithAuthor,
  WeeklyRankingRow,
  Block,
  AppRole,
  AuthorMini,
} from "@/types";

const AUTHOR_SELECT = "author:profiles!user_id(id, display_name, avatar_url, blocks, grade)";

/** 自分がいいね済みの target_id 集合を取得 */
async function fetchMyLikedIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  type: "record" | "tweet",
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await supabase
    .from("likes")
    .select("target_id")
    .eq("user_id", userId)
    .eq("target_type", type)
    .in("target_id", ids);
  return new Set((data ?? []).map((r) => r.target_id as string));
}

/** コメント数を target_id ごとに集計 */
async function fetchCommentCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  type: "record" | "tweet",
  ids: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const { data } = await supabase
    .from("comments")
    .select("target_id")
    .eq("target_type", type)
    .in("target_id", ids);
  for (const row of data ?? []) {
    const id = row.target_id as string;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

/**
 * タイムライン用フィード（練習記録 + つぶやき）を取得し、
 * created_at の新しい順にマージして返す。block でフィルタ可能。
 */
export async function getFeed(
  currentUserId: string,
  block?: Block | "all",
  limit = 30,
  grade?: string | "all",
): Promise<FeedItem[]> {
  const supabase = await createClient();

  const recordsQuery = supabase
    .from("practice_records")
    .select(`*, ${AUTHOR_SELECT}`)
    .order("created_at", { ascending: false })
    .limit(limit);

  const tweetsQuery = supabase
    .from("tweets")
    .select(`*, ${AUTHOR_SELECT}`)
    .order("created_at", { ascending: false })
    .limit(limit);

  const [{ data: recRows }, { data: twRows }] = await Promise.all([
    recordsQuery,
    tweetsQuery,
  ]);

  let records = (recRows ?? []) as unknown as RecordWithAuthor[];
  let tweets = (twRows ?? []) as unknown as TweetWithAuthor[];

  // ブロックフィルタ（投稿者の所属ブロックに含まれるかで絞る）
  if (block && block !== "all") {
    records = records.filter((r) => r.author?.blocks?.includes(block));
    tweets = tweets.filter((t) => t.author?.blocks?.includes(block));
  }

  // 学年フィルタ
  if (grade && grade !== "all") {
    records = records.filter((r) => r.author?.grade === grade);
    tweets = tweets.filter((t) => t.author?.grade === grade);
  }

  const recIds = records.map((r) => r.id);
  const twIds = tweets.map((t) => t.id);

  const [recLiked, twLiked, recComments, twComments] = await Promise.all([
    fetchMyLikedIds(supabase, currentUserId, "record", recIds),
    fetchMyLikedIds(supabase, currentUserId, "tweet", twIds),
    fetchCommentCounts(supabase, "record", recIds),
    fetchCommentCounts(supabase, "tweet", twIds),
  ]);

  const items: FeedItem[] = [
    ...records.map(
      (r): FeedItem => ({
        kind: "record",
        ...r,
        liked_by_me: recLiked.has(r.id),
        comments_count: recComments.get(r.id) ?? 0,
      }),
    ),
    ...tweets.map(
      (t): FeedItem => ({
        kind: "tweet",
        ...t,
        liked_by_me: twLiked.has(t.id),
        comments_count: twComments.get(t.id) ?? 0,
      }),
    ),
  ];

  items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return items.slice(0, limit);
}

/** ある日付の練習予定を取得 */
export async function getSchedulesOn(date: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("practice_schedules")
    .select("*")
    .eq("schedule_date", date)
    .order("meeting_time", { ascending: true });
  return data ?? [];
}

/** ユーザーの期間内の練習記録（マイページ・週間集計に使用） */
export async function getUserRecords(userId: string, fromDate?: string) {
  const supabase = await createClient();
  let q = supabase
    .from("practice_records")
    .select("*")
    .eq("user_id", userId)
    .order("recorded_date", { ascending: false });
  if (fromDate) q = q.gte("recorded_date", fromDate);
  const { data } = await q;
  return data ?? [];
}

/** 今日以降の練習予定（メニュー込み）を取得 */
export async function getUpcomingSchedules(type?: string) {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  let q = supabase
    .from("practice_schedules")
    .select("*, menus:practice_menus(*, author:profiles!author_id(display_name))")
    .gte("schedule_date", today)
    .order("schedule_date", { ascending: true });
  if (type && type !== "all") q = q.eq("schedule_type", type);
  const { data } = await q;
  return data ?? [];
}

/** お知らせ一覧 */
export async function getNotices() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notices")
    .select("*")
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** あるユーザーの PB 一覧 */
export async function getPbRecords(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pb_records")
    .select("*")
    .eq("user_id", userId)
    .order("recorded_on", { ascending: false, nullsFirst: false });
  return data ?? [];
}

/** プロフィール単体取得（他部員ページ用。ロール込み） */
export async function getProfileById(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const rolesMap = await fetchRolesByProfileIds(supabase, [id]);
  return { ...data, roles: rolesMap.get(id) ?? [] };
}

/** 全部員一覧（管理者画面用。ロール込み） */
export async function getAllProfiles() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  const rows = data ?? [];
  const rolesMap = await fetchRolesByProfileIds(
    supabase,
    rows.map((p) => p.id as string),
  );
  return rows.map((p) => ({ ...p, roles: rolesMap.get(p.id as string) ?? [] }));
}

/** メンバー一覧（在籍中の部員。名簿表示用） */
export async function getMembersList(): Promise<AuthorMini[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, blocks, grade")
    .eq("status", "active")
    .order("display_name", { ascending: true });
  return (data ?? []) as unknown as AuthorMini[];
}

/** 全ロール定義を取得（管理画面用） */
export async function getAllRoles(): Promise<AppRole[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("roles")
    .select("*")
    .order("is_system", { ascending: false })
    .order("created_at", { ascending: true });
  return (data ?? []) as AppRole[];
}

/** あるユーザーの投稿（練習記録 + つぶやき）をマージして返す（マイページ用） */
export async function getUserActivity(
  userId: string,
  currentUserId: string,
  limit = 50,
): Promise<FeedItem[]> {
  const supabase = await createClient();

  const [{ data: recRows }, { data: twRows }] = await Promise.all([
    supabase
      .from("practice_records")
      .select(`*, ${AUTHOR_SELECT}`)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("tweets")
      .select(`*, ${AUTHOR_SELECT}`)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const records = (recRows ?? []) as unknown as RecordWithAuthor[];
  const tweets = (twRows ?? []) as unknown as TweetWithAuthor[];
  const recIds = records.map((r) => r.id);
  const twIds = tweets.map((t) => t.id);

  const [recLiked, twLiked, recComments, twComments] = await Promise.all([
    fetchMyLikedIds(supabase, currentUserId, "record", recIds),
    fetchMyLikedIds(supabase, currentUserId, "tweet", twIds),
    fetchCommentCounts(supabase, "record", recIds),
    fetchCommentCounts(supabase, "tweet", twIds),
  ]);

  const items: FeedItem[] = [
    ...records.map(
      (r): FeedItem => ({
        kind: "record",
        ...r,
        liked_by_me: recLiked.has(r.id),
        comments_count: recComments.get(r.id) ?? 0,
      }),
    ),
    ...tweets.map(
      (t): FeedItem => ({
        kind: "tweet",
        ...t,
        liked_by_me: twLiked.has(t.id),
        comments_count: twComments.get(t.id) ?? 0,
      }),
    ),
  ];
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return items;
}

/** ホームに表示する重要お知らせ（pin_home・期限内・未非表示） */
export async function getHomeNotices(userId: string) {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: notices }, { data: dismissed }] = await Promise.all([
    supabase
      .from("notices")
      .select("*")
      .eq("pin_home", true)
      .or(`deadline.is.null,deadline.gte.${today}`)
      .order("created_at", { ascending: false }),
    supabase.from("notice_dismissals").select("notice_id").eq("user_id", userId),
  ]);

  const dismissedIds = new Set((dismissed ?? []).map((d) => d.notice_id as string));
  return (notices ?? []).filter((n) => !dismissedIds.has(n.id));
}

/** 出欠対象の今後の予定（出欠は別途取得） */
export async function getAttendanceSchedules(limit = 10) {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("practice_schedules")
    .select("*")
    .gte("schedule_date", today)
    .in("schedule_type", ["practice", "meet", "event"])
    .order("schedule_date", { ascending: true })
    .limit(limit);
  return data ?? [];
}

/** 指定した予定群の出欠（profile 付き） */
export async function getAttendancesForSchedules(scheduleIds: string[]) {
  if (scheduleIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("attendances")
    .select("schedule_id, user_id, status, profile:profiles!user_id(id, display_name, avatar_url, blocks, grade)")
    .in("schedule_id", scheduleIds);
  return (data ?? []) as unknown as {
    schedule_id: string;
    user_id: string;
    status: "present" | "absent";
    profile: import("@/types").AuthorMini;
  }[];
}

/** 週間ランキング（中長距離） */
export async function getWeeklyRanking(): Promise<WeeklyRankingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("weekly_ranking")
    .select("*")
    .order("total_km", { ascending: false });
  return (data ?? []) as unknown as WeeklyRankingRow[];
}

/** 自分がお気に入り登録している部員IDの一覧 */
export async function getMyFavoriteIds(userId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("favorites")
    .select("favorite_user_id")
    .eq("user_id", userId);
  return (data ?? []).map((f) => f.favorite_user_id as string);
}

/** 自分が対象ユーザーをお気に入り登録しているか */
export async function isFavorite(userId: string, targetId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("favorites")
    .select("favorite_user_id")
    .eq("user_id", userId)
    .eq("favorite_user_id", targetId)
    .maybeSingle();
  return !!data;
}
