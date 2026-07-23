import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { jstToday } from "@/lib/date";
import { refreshMemberFromSheetLive } from "@/lib/sheet-sync";
import {
  normalizeNoteArticleRow,
  normalizeNoteRow,
  normalizeNotificationRow,
  normalizeScheduleRow,
  normalizeThreadPostRow,
  normalizeThreadRow,
} from "@/lib/query-normalize";
import {
  normalizeAuthorRow,
  normalizeProfileRow,
  normalizeRecordWithAuthor,
  normalizeTweetWithAuthor,
} from "@/lib/profile-normalize";
import type {
  ThreadPostWithAuthor,
  ThreadWithAuthor,
  FeedItem,
  WeeklyRankingRow,
  Block,
  AppRole,
  RoleCategory,
  AuthorMini,
  Notice,
  NoticeReaction,
  NoticeWithReactions,
  NoteArticleWithAuthor,
  NoteWithRelations,
  AppNotificationWithActor,
  Profile,
  PracticeRecord,
} from "@/types";

const AUTHOR_SELECT =
  "author:profiles!user_id(id, display_name, avatar_url, blocks, grade, record_source, record_fields)";
const NOTICE_REACTIONS: NoticeReaction[] = ["ack", "thanks", "question"];
function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

// 練習記録の表示フィルタ。
// タイムライン等のソーシャル表示は「未来日除外・中身あり」。
// スプシ由来(from_sheet=true)の記録もタイムラインに表示するが、連携直後に古い記録が
// 一気に流れ込んで埋まらないよう、この機能を入れた日以降の recorded_date だけ対象にする。
const SHEET_TIMELINE_CUTOFF = "2026-07-04";
const SHEET_TIMELINE_OR = `from_sheet.eq.false,and(from_sheet.eq.true,recorded_date.gte.${SHEET_TIMELINE_CUTOFF})`;
// 中身が空でない（距離いずれか>0、または各テキストが非null）
const RECORD_NONEMPTY_OR =
  "dist_low.gt.0,dist_mid.gt.0,dist_high.gt.0,dist_speed.gt.0,strides.gt.0," +
  "result_text.not.is.null,strength_text.not.is.null,memo.not.is.null," +
  "menu_text.not.is.null,focus_text.not.is.null";

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
  // 全行取得→JS集計ではなく、DB側でGROUP BY集計するRPCを使う（P4）
  const { data } = await supabase.rpc("count_comments_by_target", {
    target_type_in: type,
    target_ids: ids,
  });
  for (const row of (data ?? []) as { target_id: string; count: number }[]) {
    map.set(row.target_id, Number(row.count));
  }
  return map;
}

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
    .select(`*, ${AUTHOR_SELECT}`)
    .order("created_at", { ascending: false })
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
  const tweets = (twRows ?? []).map(normalizeTweetWithAuthor);

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

  items.sort((a, b) =>
    a.created_at === b.created_at
      ? b.id.localeCompare(a.id)
      : a.created_at < b.created_at ? 1 : -1,
  );
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

/**
 * 記録のメインがスプシ(record_source='sheet')の本人が記録画面を開く直前に呼ぶ。
 * 毎時同期を待たず、その場でスプシの最新内容をDB(Supabaseミラー)へ非破壊で反映する
 * （タスク16残作業。他部員の記録を見ているだけの閲覧者から誤って書き込まないよう、
 * 呼び出し側は必ず本人(isSelf)のときだけ呼ぶこと）。GAS不調時は何もせず現状のDBのまま表示する。
 */
export async function refreshOwnSheetRecords(
  profile: Pick<Profile, "id" | "sheet_name" | "record_source" | "record_fields" | "sheet_linked_at">,
) {
  if (profile.record_source !== "sheet" || !profile.sheet_name) return;
  const supabase = await createClient();
  await refreshMemberFromSheetLive(supabase, profile);
}

/** ユーザーの期間内の練習記録（マイページ・週間集計に使用） */
export async function getUserRecords(userId: string, fromDate?: string) {
  const supabase = await createClient();
  // fromDate省略時も無期限取得はしない（TrainingChartの最大表示期間は12ヶ月分）。
  const defaultFromDate = new Date();
  defaultFromDate.setDate(defaultFromDate.getDate() - 400);
  const q = supabase
    .from("practice_records")
    .select("*")
    .eq("user_id", userId)
    .lte("recorded_date", jstToday()) // 未来日は除外
    .or(RECORD_NONEMPTY_OR) // 空の記録は除外
    .gte("recorded_date", fromDate ?? defaultFromDate.toISOString().slice(0, 10))
    .order("recorded_date", { ascending: false });
  const { data } = await q;
  return data ?? [];
}

/** 他部員ページ用。記録に閲覧者本人のいいね状態とコメント数を付与する。 */
export async function getUserRecordsWithSocialState(
  userId: string,
  currentUserId: string,
): Promise<PracticeRecord[]> {
  const records = (await getUserRecords(userId)) as PracticeRecord[];
  const ids = records.map((record) => record.id);
  const supabase = await createClient();
  const [liked, comments] = await Promise.all([
    fetchMyLikedIds(supabase, currentUserId, "record", ids),
    fetchCommentCounts(supabase, "record", ids),
  ]);
  return records.map((record) => ({
    ...record,
    liked_by_me: liked.has(record.id),
    comments_count: comments.get(record.id) ?? 0,
  }));
}

/** 今日以降の練習予定（メニュー込み）を取得 */
function filterSchedulesForViewer<T extends { target_blocks?: string[] | null }>(
  schedules: T[],
  viewerBlocks: Block[],
  canManage: boolean,
): T[] {
  if (canManage) return schedules;
  const viewerBlockSet = new Set<string>(viewerBlocks);
  return schedules.filter((schedule) => {
    const targets = schedule.target_blocks ?? [];
    return targets.length === 0 || targets.some((block) => viewerBlockSet.has(block));
  });
}

export async function getUpcomingSchedules(
  viewerBlocks: Block[],
  canManage: boolean,
  type?: string,
) {
  const supabase = await createClient();
  const today = jstToday();
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
  const { data, error } = await q;
  if (error) throw new Error("Failed to load upcoming schedules: " + error.message);
  return filterSchedulesForViewer(data ?? [], viewerBlocks, canManage)
    .map(normalizeScheduleRow)
    .filter(isPresent);
}

/** 予定一覧用。出欠を同じクエリに含め、一覧初期表示の往復を減らす。 */
export async function getUpcomingSchedulesWithAttendances(
  viewerBlocks: Block[],
  canManage: boolean,
  limit = 200,
) {
  const supabase = await createClient();
  const today = jstToday();
  const { data, error } = await supabase
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
      ),
      attendances(
        schedule_id,
        user_id,
        status,
        is_late,
        late_note,
        profile:profiles!user_id(id, display_name, avatar_url, blocks, grade)
      )
    `)
    .gte("schedule_date", today)
    .order("schedule_date", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to load upcoming schedules: ${error.message}`);
  return filterSchedulesForViewer(data ?? [], viewerBlocks, canManage)
    .map(normalizeScheduleRow)
    .filter(isPresent);
}

/** お知らせ一覧（直近200件。無期限の全件取得はしない） */
export async function getNotices(userId: string): Promise<NoticeWithReactions[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notices")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
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
  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  if (!data) return null;
  const rolesMap = await fetchRolesByProfileIds(supabase, [id]);
  return normalizeProfileRow(data, rolesMap.get(id) ?? []);
}

/** 全部員一覧（管理者画面用。ロール込み） */
export async function getAllProfiles() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load profiles: ${error.message}`);
  const rows = data ?? [];
  const rolesMap = await fetchRolesByProfileIds(
    supabase,
    rows.map((p) => p.id as string),
  );
  return rows.map((profile) => normalizeProfileRow(profile, rolesMap.get(profile.id) ?? []));
}

/** メンバー一覧（在籍中かつ承認済みの部員。名簿表示用） */
export async function getMembersList(): Promise<AuthorMini[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, blocks, grade, record_source, record_fields")
    .eq("status", "active")
    .eq("approved", true)
    .order("display_name", { ascending: true });
  return (data ?? []).map(normalizeAuthorRow);
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

/** ロールカテゴリ一覧を取得（管理画面用） */
export async function getAllRoleCategories(): Promise<RoleCategory[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("role_categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as RoleCategory[];
}
/** あるユーザーの投稿（練習記録 + つぶやき）をマージして返す（マイページ用） */
export async function getUserActivity(
  userId: string,
  currentUserId: string,
  limit = 50,
): Promise<FeedItem[]> {
  const supabase = await createClient();

  const [recordsResult, tweetsResult] = await Promise.all([
    supabase
      .from("practice_records")
      .select(`*, ${AUTHOR_SELECT}`)
      .eq("user_id", userId)
      .lte("recorded_date", jstToday())
      .or(RECORD_NONEMPTY_OR)
      .or(SHEET_TIMELINE_OR)
      .order("recorded_date", { ascending: false })
      .limit(limit),
    supabase
      .from("tweets")
      .select(`*, ${AUTHOR_SELECT}`)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);
  if (recordsResult.error) throw new Error("Failed to load member records: " + recordsResult.error.message);
  if (tweetsResult.error) throw new Error("Failed to load member posts: " + tweetsResult.error.message);
  const recRows = recordsResult.data;
  const twRows = tweetsResult.data;

  const records = (recRows ?? []).map(normalizeRecordWithAuthor);
  const tweets = (twRows ?? []).map(normalizeTweetWithAuthor);
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
  const today = jstToday();
  const tomorrow = jstToday(1);

  const [{ data: notices }, { data: dismissed }, { data: acknowledged }] = await Promise.all([
    supabase
      .from("notices")
      .select("*")
      .or(`deadline.is.null,deadline.gte.${today}`)
      .order("created_at", { ascending: false }),
    supabase.from("notice_dismissals").select("notice_id").eq("user_id", userId),
    supabase.from("notice_reactions").select("notice_id").eq("user_id", userId).eq("reaction", "ack"),
  ]);

  const dismissedIds = new Set((dismissed ?? []).map((dismissal) => dismissal.notice_id as string));
  const acknowledgedIds = new Set((acknowledged ?? []).map((reaction) => reaction.notice_id as string));
  // 「確認」を付けたお知らせは重要指定を含めホームから除外する。
  const visible = ((notices ?? []) as Notice[]).filter(
    (notice) => !acknowledgedIds.has(notice.id) && (notice.pin_home || !dismissedIds.has(notice.id)),
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
  const today = jstToday();
  const { data, error } = await supabase
    .from("practice_schedules")
    .select("*")
    .gte("schedule_date", today)
    .in("schedule_type", ["practice", "meet", "event"])
    .order("schedule_date", { ascending: true })
    .limit(Math.max(30, limit * 3));
  if (error) throw new Error(`Failed to load attendance schedules: ${error.message}`);
  return filterSchedulesForViewer(data ?? [], viewerBlocks, canManage).slice(0, limit);
}

/** 指定した予定群の出欠（profile 付き） */
export async function getAttendancesForSchedules(scheduleIds: string[]) {
  if (scheduleIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendances")
    .select("schedule_id, user_id, status, is_late, late_note, profile:profiles!user_id(id, display_name, avatar_url, blocks, grade)")
    .in("schedule_id", scheduleIds);
  if (error) throw new Error("Failed to load attendances: " + error.message);
  return (data ?? []).flatMap((row) => {
    if (row.status !== "present" && row.status !== "absent") return [];
    return [{
      ...row,
      status: row.status as "present" | "absent",
      profile: normalizeAuthorRow(row.profile),
    }];
  });
}

/** 週間ランキング（中長距離） */
export async function getWeeklyRanking(): Promise<WeeklyRankingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("weekly_ranking")
    .select("*")
    .order("total_km", { ascending: false });
  return (data ?? []).flatMap((row) => {
    if (!row.id || !row.display_name || !row.period_start || !row.period_end) return [];
    return [{
      id: row.id,
      display_name: row.display_name,
      grade: row.grade,
      blocks: (row.blocks ?? []).filter((block): block is Block =>
        block === "middle_long" || block === "short" || block === "jump" || block === "throw"
      ),
      avatar_url: row.avatar_url,
      km_low: row.km_low ?? 0,
      km_mid: row.km_mid ?? 0,
      km_high: row.km_high ?? 0,
      km_speed: row.km_speed ?? 0,
      total_km: row.total_km ?? 0,
      period_start: row.period_start,
      period_end: row.period_end,
    }];
  });
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
    notes: (notes ?? []).map(normalizeNoteRow).filter(isPresent),
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
  return data ? normalizeNoteRow(data) : null;
}

/** スレッド一覧（新しい返信があった順） */
export async function getThreads(): Promise<ThreadWithAuthor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("threads")
    .select(`*, author:profiles!author_id(id, display_name, avatar_url, blocks, grade), posts:thread_posts(id)`)
    .order("updated_at", { ascending: false });
  return (data ?? []).map(normalizeThreadRow);
}

/** Threads directly inside a note folder, newest activity first. */
export async function getThreadsByFolder(folderId: string): Promise<ThreadWithAuthor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("threads")
    .select(`*, author:profiles!author_id(id, display_name, avatar_url, blocks, grade), posts:thread_posts(id)`)
    .eq("folder_id", folderId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map(normalizeThreadRow);
}

/** スレッド詳細 */
export async function getThreadById(id: string): Promise<ThreadWithAuthor | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("threads")
    .select(`*, author:profiles!author_id(id, display_name, avatar_url, blocks, grade)`)
    .eq("id", id)
    .maybeSingle();
  return data ? normalizeThreadRow(data) : null;
}

/** スレッドの投稿（古い順=会話の流れ） */
export async function getThreadPosts(threadId: string): Promise<ThreadPostWithAuthor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("thread_posts")
    .select(`*, author:profiles!author_id(id, display_name, avatar_url, blocks, grade)`)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  return (data ?? []).map(normalizeThreadPostRow);
}

/** フォルダ直下のサブフォルダ一覧（RLS継承） */
export async function getChildNotes(parentId: string): Promise<NoteWithRelations[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("parent_id", parentId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map(normalizeNoteRow).filter(isPresent);
}

/** パンくず用の祖先チェーン（ルート側から順）。深さ上限3のため最大2回辿る */
export async function getNoteAncestors(
  note: { parent_id: string | null },
): Promise<{ id: string; title: string }[]> {
  const supabase = await createClient();
  const chain: { id: string; title: string }[] = [];
  let parentId = note.parent_id;
  for (let i = 0; i < 2 && parentId; i++) {
    const { data } = await supabase
      .from("notes")
      .select("id, title, parent_id")
      .eq("id", parentId)
      .maybeSingle();
    if (!data) break;
    chain.unshift({ id: data.id as string, title: data.title as string });
    parentId = (data as { parent_id: string | null }).parent_id;
  }
  return chain;
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
  return (data ?? []).map(normalizeNoteArticleRow);
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
  return data ? normalizeNoteArticleRow(data) : null;
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
  return (data ?? []).map(normalizeNoteRow).filter(isPresent);
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
  return (data ?? []).map(normalizeNoteRow).filter(isPresent);
}

/** 直近50件（無期限の全件取得はしない） */
export async function getPersonalNotifications(userId: string): Promise<AppNotificationWithActor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select(`
      *,
      actor:profiles!actor_id(id, display_name, avatar_url)
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []).map(normalizeNotificationRow).filter(isPresent);
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
