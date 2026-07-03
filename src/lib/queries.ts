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
  Notice,
  NoticeReaction,
  NoticeWithReactions,
  NoteArticleWithAuthor,
  NoteWithRelations,
  AppNotificationWithActor,
} from "@/types";

const AUTHOR_SELECT = "author:profiles!user_id(id, display_name, avatar_url, blocks, grade)";
const NOTICE_REACTIONS: NoticeReaction[] = ["ack", "thanks", "question"];

// 練習記録の表示フィルタ。
// タイムライン等のソーシャル表示は「アプリ投稿のみ（from_sheet=false）・未来日除外・中身あり」。
// スプシ同期で取り込んだ記録(from_sheet=true)はタイムラインには出さない（マイページ集計には含む）。
// 中身が空でない（距離いずれか>0、または各テキストが非null）
const RECORD_NONEMPTY_OR =
  "dist_low.gt.0,dist_mid.gt.0,dist_high.gt.0,dist_speed.gt.0,strides.gt.0," +
  "result_text.not.is.null,strength_text.not.is.null,memo.not.is.null," +
  "menu_text.not.is.null,focus_text.not.is.null";

function dateInJapan(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function withNoticeReactions(
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
    .eq("from_sheet", false) // タイムラインはアプリ投稿のみ
    .lte("recorded_date", dateInJapan())
    .or(RECORD_NONEMPTY_OR)
    .order("recorded_date", { ascending: false })
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
    .lte("recorded_date", dateInJapan()) // 未来日は除外
    .or(RECORD_NONEMPTY_OR) // 空の記録は除外
    .order("recorded_date", { ascending: false });
  if (fromDate) q = q.gte("recorded_date", fromDate);
  const { data } = await q;
  return data ?? [];
}

/** 今日以降の練習予定（メニュー込み）を取得 */
function filterSchedulesForViewer<T extends { target_blocks?: Block[] | null }>(
  schedules: T[],
  viewerBlocks: Block[],
  canManage: boolean,
): T[] {
  if (canManage) return schedules;
  return schedules.filter((schedule) => {
    const targets = schedule.target_blocks ?? [];
    return targets.length === 0 || targets.some((block) => viewerBlocks.includes(block));
  });
}

export async function getUpcomingSchedules(
  viewerBlocks: Block[],
  canManage: boolean,
  type?: string,
) {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  let q = supabase
    .from("practice_schedules")
    .select(`
      *,
      menus:practice_menus(
        *,
        author:profiles!author_id(id, display_name),
        targets:practice_menu_targets(
          menu_id,
          user_id,
          profile:profiles!user_id(id, display_name, avatar_url, blocks, grade)
        )
      )
    `)
    .gte("schedule_date", today)
    .order("schedule_date", { ascending: true });
  if (type && type !== "all") q = q.eq("schedule_type", type);
  const { data } = await q;
  return filterSchedulesForViewer(data ?? [], viewerBlocks, canManage);
}

/** お知らせ一覧 */
export async function getNotices(userId: string): Promise<NoticeWithReactions[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notices")
    .select("*")
    .order("created_at", { ascending: false });
  return withNoticeReactions(supabase, (data ?? []) as Notice[], userId);
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

/** メンバー一覧（在籍中かつ承認済みの部員。名簿表示用） */
export async function getMembersList(): Promise<AuthorMini[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, blocks, grade")
    .eq("status", "active")
    .eq("approved", true)
    .order("display_name", { ascending: true });
  return (data ?? []) as unknown as AuthorMini[];
}

/** 全ロール定義を取得（管理画面用） */
export async function getAllRoles(): Promise<AppRole[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("roles")
    .select("*")
    .order("sort_order", { ascending: true })
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
      .eq("from_sheet", false) // 投稿一覧はアプリ投稿のみ
      .lte("recorded_date", dateInJapan())
      .or(RECORD_NONEMPTY_OR)
      .order("recorded_date", { ascending: false })
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

/** ホーム: 重要は全件、通常は直近3件、明日締切は件数外で表示 */
export async function getHomeNotices(userId: string): Promise<NoticeWithReactions[]> {
  const supabase = await createClient();
  const today = dateInJapan();
  const tomorrow = dateInJapan(1);

  const [{ data: notices }, { data: dismissed }] = await Promise.all([
    supabase
      .from("notices")
      .select("*")
      .or(`deadline.is.null,deadline.gte.${today}`)
      .order("created_at", { ascending: false }),
    supabase.from("notice_dismissals").select("notice_id").eq("user_id", userId),
  ]);

  const dismissedIds = new Set((dismissed ?? []).map((d) => d.notice_id as string));
  // 重要なお知らせ(pin_home)は消せない＝既読/非表示の対象外で常に表示する
  const visible = ((notices ?? []) as Notice[]).filter(
    (notice) => notice.pin_home || !dismissedIds.has(notice.id),
  );
  const important = visible.filter((notice) => notice.pin_home);
  const reminders = visible.filter((notice) => notice.deadline === tomorrow);
  const recent = visible.filter((notice) => !notice.pin_home).slice(0, 3);
  const selected = new Map<string, Notice>();
  for (const notice of [...important, ...reminders, ...recent]) {
    selected.set(notice.id, notice);
  }
  const ordered = [...selected.values()].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );
  return withNoticeReactions(supabase, ordered, userId);
}

/** 出欠対象の今後の予定（出欠は別途取得） */
export async function getAttendanceSchedules(
  viewerBlocks: Block[],
  canManage: boolean,
  limit = 10,
) {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("practice_schedules")
    .select("*")
    .gte("schedule_date", today)
    .in("schedule_type", ["practice", "meet", "event"])
    .order("schedule_date", { ascending: true });
  return filterSchedulesForViewer(data ?? [], viewerBlocks, canManage).slice(0, limit);
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

/** 会場一覧（管理用：全件） */
export async function getAllVenues() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("venues")
    .select("*")
    .order("sort", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as import("@/types").VenueRow[];
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

const NOTE_SELECT = `
  *,
  author:profiles!author_id(id, display_name, avatar_url, blocks, grade),
  theme:note_themes(*),
  articles:note_articles(id),
  editors:note_editors(
    user_id,
    profile:profiles!user_id(id, display_name, avatar_url, blocks, grade)
  )
`;

/** RLSで閲覧可能なノートフォルダを取得 */
export async function getNotesData(): Promise<{
  notes: NoteWithRelations[];
}> {
  const supabase = await createClient();
  const { data: notes } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .order("updated_at", { ascending: false });
  return {
    notes: (notes ?? []) as unknown as NoteWithRelations[],
  };
}

/** ノート詳細。RLSにより閲覧不可なら null */
export async function getNoteById(id: string): Promise<NoteWithRelations | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as NoteWithRelations | null) ?? null;
}

/** フォルダ内の記事一覧。フォルダRLSを継承する */
export async function getNoteArticles(
  noteId: string,
): Promise<NoteArticleWithAuthor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("note_articles")
    .select(`
      *,
      author:profiles!author_id(id, display_name, avatar_url, blocks, grade)
    `)
    .eq("note_id", noteId)
    .order("updated_at", { ascending: false });
  return (data ?? []) as unknown as NoteArticleWithAuthor[];
}

/** 記事詳細。親フォルダのRLSにより閲覧不可ならnull */
export async function getNoteArticleById(
  noteId: string,
  articleId: string,
): Promise<NoteArticleWithAuthor | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("note_articles")
    .select(`
      *,
      author:profiles!author_id(id, display_name, avatar_url, blocks, grade)
    `)
    .eq("note_id", noteId)
    .eq("id", articleId)
    .maybeSingle();
  return (data as unknown as NoteArticleWithAuthor | null) ?? null;
}

/** ホームに表示する最近の共有ノート（RLSで閲覧可能なもの） */
export async function getRecentSharedNotes(
  limit = 3,
): Promise<NoteWithRelations[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("scope", "shared")
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as NoteWithRelations[];
}

/** プロフィールに表示する公開個人ノート */
export async function getPublishedPersonalNotes(
  authorId: string,
): Promise<NoteWithRelations[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("author_id", authorId)
    .eq("scope", "personal")
    .eq("status", "published")
    .order("updated_at", { ascending: false });
  return (data ?? []) as unknown as NoteWithRelations[];
}

export async function getPersonalNotifications(userId: string): Promise<AppNotificationWithActor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select(`
      *,
      actor:profiles!actor_id(id, display_name, avatar_url)
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as AppNotificationWithActor[];
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  return count ?? 0;
}
