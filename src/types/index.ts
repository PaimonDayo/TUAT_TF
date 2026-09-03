// ─────────────────────────────────────────────
// 全型定義
// ─────────────────────────────────────────────

export type Block = "middle_long" | "short" | "manager" | "jump" | "throw";
/** 旧・単一ロール（profiles.role 列。互換目的で残置） */
export type Role = "admin" | "menu_staff" | "member";
export type ProfileStatus = "active" | "graduated";

/** 権限の種類 */
export type Permission =
  | "manage_system" // システム管理（最上位権限）
  | "manage_members" // 部員・ロール管理
  | "create_schedule" // 練習予定の作成
  | "create_menu" // 練習メニューの作成
  | "create_notice" // お知らせの作成
  | "decide_practice"; // 練習の開催を決定する（雨天対応など）

/** カスタムロール（roles テーブル） */
export interface AppRole {
  id: string;
  name: string;
  can_manage_system: boolean;
  can_manage_members: boolean;
  can_create_schedule: boolean;
  can_create_menu: boolean;
  can_create_notice: boolean;
  can_decide_practice: boolean;
  is_system: boolean;
  /** 全ユーザーへ個別割当なしで適用する固定ロール。 */
  is_everyone: boolean;
  color: string;
  /** 表示上のカテゴリ（フォルダ分け。任意） */
  category: string | null;
  sort_order: number;
  created_at: string;
}
export interface RoleCategory {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}
export type Condition = "great" | "normal" | "bad";
export type Intensity = "low" | "mid" | "high" | "speed";
export type ScheduleType = "practice" | "meet" | "event" | "time_trial";
export type NoticeCategory = "fee" | "entry" | "info" | "rule";
export type NoticeReaction = "ack" | "thanks" | "question";
export type TargetType = "record" | "tweet";
export type AttendanceStatus = "present" | "absent";
/** 一覧を開いたとき最初に表示するブロック（出欠一覧・タイムライン共通の考え方） */
export type BlockViewDefault = "all" | "middle_long" | "short";
export type AttendanceDefaultBlock = BlockViewDefault;
export type TimelineDefaultBlock = BlockViewDefault;
export type NoteScope = "shared" | "personal";
export type NoteStatus = "draft" | "published";
export type NoteEditPolicy = "everyone" | "specified" | "author";

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  mention_reading: string | null;
  avatar_url: string | null;
  blocks: Block[];
  /** 専門種目（任意・複数可。情報表示用） */
  events: string[];
  grade: string | null;
  /** 目標（自由入力。マイページから設定） */
  goal: string | null;
  role: Role;
  /** 付与されているロール一覧（複数可） */
  roles: AppRole[];
  status: ProfileStatus;
  /** 大学ドメイン認証済みユーザーは自動承認。列は互換性のため保持。 */
  approved: boolean;
  notify_comment: boolean;
  notify_notice: boolean;
  menu_view_all_blocks: boolean;
  schedule_view_all_blocks: boolean;
  attendance_view_all_blocks: boolean;
  notify_mention: boolean;
  attendance_default_block: AttendanceDefaultBlock;
  /** タイムラインを開いたとき最初に表示するブロックタブ */
  timeline_default_block: TimelineDefaultBlock;
  /** スプレッドシート同期で使う、自分のシート名（例: B2駒井）。未設定なら同期対象外 */
  sheet_name: string | null;
  /** シート連携した日(JST) */
  sheet_linked_at: string | null;
  /** シート開始日からの初回履歴取込が完了した時刻。未完了ならnull */
  sheet_history_imported_at: string | null;
  sheet_header_signature: string | null;
  /** 記録のメインDB。'sheet'ならスプシが正でアプリからの保存は即write-through、'app'ならアプリが正でスプシへ書き戻す */
  record_source: "app" | "sheet";
  /** 記録フォームのカスタム項目定義（短距離など独自列の人向け） */
  record_fields: RecordFieldDef[];
  record_fields_version: number;
  created_at: string;
}

/** ユーザーが追加できる記録フォームのカスタム項目 */
export interface RecordFieldDef {
  /** 安定したキー（custom JSONB のキーになる） */
  key: string;
  /** 表示ラベル */
  label: string;
  type: "text" | "number";
  /** 既定項目を記録フォームとカードから外す。カスタム項目では未使用。 */
  hidden?: boolean;
  /** スプレッドシート上の元見出し。表示名を変えても同期列を見失わないため保持する。 */
  sourceHeader?: string;
  /** 0始まりの列位置。重複見出しを区別するため保持する。 */
  sourceColumn?: number;
  /** Whether this field is shown on timeline cards. */
  showInTimeline?: boolean;
}

/** 投稿カードに埋め込む投稿者の最小情報 */
export type AuthorMini = Pick<
  Profile,
  "id" | "display_name" | "avatar_url" | "blocks" | "grade"
> & {
  /** 練習記録カードの編集可否判定に使う。取得していない画面ではundefinedでよい（'app'相当として扱う） */
  record_source?: Profile["record_source"];
  /** 練習記録の表示ラベル。タイムライン取得時のみ含まれる。 */
  record_fields?: RecordFieldDef[];
};

export interface PracticeRecord {
  id: string;
  user_id: string;
  recorded_date: string;
  dist_low: number;
  dist_mid: number;
  dist_high: number;
  dist_speed: number;
  strides: number;
  /** 強度別がすべて0のときだけ合計表示に使う、シートの「実際の距離」。 */
  dist_actual: number;
  result_text: string | null;
  strength_text: string | null;
  memo: string | null;
  /** 短距離・跳躍・投擲向け: 実施メニュー */
  menu_text: string | null;
  /** 短距離・跳躍・投擲向け: 目的・意識すること */
  focus_text: string | null;
  condition: Condition | null;
  likes_count: number;
  created_at: string;
  /** アプリ側の最終更新（スプシ同期の last-writer-wins 判定用） */
  updated_at?: string;
  /** 最後にスプシと突合した時刻 */
  synced_at?: string | null;
  /** カスタム項目の値（key→値） */
  custom?: Record<string, string | number | null>;
  /** Field configuration captured when this record was created. */
  record_fields_snapshot?: RecordFieldDef[];
  record_fields_version?: number | null;
  /** スプシ同期で取り込んだ記録か（true ならソーシャルなタイムラインには出さない） */
  from_sheet?: boolean;
}

/** 投稿者情報を join した練習記録 */
export interface RecordWithAuthor extends PracticeRecord {
  author: AuthorMini;
  liked_by_me?: boolean;
  comments_count?: number;
}

export interface Tweet {
  id: string;
  user_id: string;
  content: string;
  likes_count: number;
  created_at: string;
  image_path: string | null;
  expires_at: string | null;
  poll_multiple: boolean;
  poll_anonymous: boolean;
  poll_allow_options: boolean;
}
export interface TweetPollVoter {
  profile_id: string;
  display_name: string;
  avatar_url: string | null;
  blocks: Block[];
  grade: string | null;
}


export interface TweetPollOption {
  id: string;
  tweet_id: string;
  text: string;
  created_by: string;
  sort_order: number;
  vote_count: number;
  voted_by_me: boolean;
  voters: TweetPollVoter[];
}

export interface TweetMention {
  profile_id: string;
  display_name: string;
}

export interface TweetPoll {
  options: TweetPollOption[];
}

export interface TweetWithAuthor extends Tweet {
  author: AuthorMini;
  liked_by_me?: boolean;
  comments_count?: number;
  poll?: TweetPoll;
  mentions?: TweetMention[];
}

export interface Like {
  id: string;
  user_id: string;
  target_type: TargetType;
  target_id: string;
  created_at: string;
}

export interface Comment {
  id: string;
  user_id: string;
  target_type: TargetType;
  target_id: string;
  content: string;
  sheet_reply_index?: number | null;
  created_at: string;
  updated_at: string;
}

export type CommentAuthor = Pick<Profile, "id" | "display_name" | "avatar_url"> & { systemRecordForm?: boolean };

export interface CommentWithAuthor extends Comment {
  author: CommentAuthor;
}

export interface VenueRow {
  id: string;
  name: string;
  short: string | null;
  access: string | null;
  fee: string | null;
  url: string | null;
  pinned: boolean;
  sort: number;
  created_at: string;
}

export interface PracticeSchedule {
  id: string;
  schedule_date: string;
  schedule_type: ScheduleType;
  meeting_time: string | null;
  location: string | null;
  venue_name: string | null;
  venue_access: string | null;
  venue_fee: string | null;
  title: string | null;
  end_date: string | null;
  entry_start: string | null;
  entry_end: string | null;
  venue_url: string | null;
  note: string | null;
  /** 雨天時など「開催するか話し合い中」等を伝える対応状況（任意） */
  weather_note: string | null;
  weather_note_updated_at: string | null;
  weather_note_updated_by: string | null;
  /** 中止にした日時。null なら通常どおり実施 */
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  target_blocks: Block[];
  source_sheet_id?: string | null;
  created_by: string;
  created_at: string;
}

export type ScheduleSheetKind = "practice" | "meet" | "time_trial";
export type ScheduleSheetBlock = "all" | Block;

export interface ScheduleSheetWeekdayDefault {
  weekday: number;
  time: string;
  venueName: string;
}

export interface ScheduleSheet {
  id: string;
  author_id: string;
  target_year: number | null;
  target_month: number | null;
  kind: ScheduleSheetKind;
  target_block: ScheduleSheetBlock;
  sheet_url: string;
  csv_url: string | null;
  last_imported_at: string | null;
  status: "active" | "archived";
  created_at: string;
}

export interface ScheduleImportRow {
  rowNumber: number;
  id?: string;
  schedule_date: string;
  end_date: string | null;
  schedule_type: ScheduleSheetKind;
  meeting_time: string | null;
  venue_name: string | null;
  venue_access: string | null;
  venue_fee: string | null;
  venue_url: string | null;
  title: string | null;
  entry_start: string | null;
  entry_end: string | null;
  note: string | null;
  target_blocks: Block[];
  /** 実物スプシ(メニュー/ペース/補足/補強列)から、対応する予定に紐づくブロック全体メニューを生成/更新するための値 */
  menu_content?: string | null;
  menu_pace?: string | null;
  menu_remark?: string | null;
  menu_supplement?: string | null;
}

export type ScheduleImportRowStatus =
  | "addition"
  | "update"
  | "error"
  | "skip"
  | "editing";

export interface ScheduleImportEditableRow {
  rowNumber: number;
  values: Record<string, string>;
  status: ScheduleImportRowStatus;
  message: string | null;
  normalized: ScheduleImportRow | null;
}

export interface ScheduleImportPreview {
  columns: string[];
  rows: ScheduleImportEditableRow[];
  additions: ScheduleImportRow[];
  updates: ScheduleImportRow[];
  deletions: PracticeSchedule[];
  errors: { rowNumber: number; message: string }[];
  skips: { rowNumber: number; message: string }[];
}

export interface MenuImportRow {
  rowNumber: number;
  scheduleId: string;
  scheduleDate: string;
  targetBlock: Block;
  content: string;
  pace: string | null;
  remark: string | null;
  supplement: string | null;
  existingMenuId: string | null;
}

export type MenuImportRowStatus = "addition" | "update" | "error" | "skip" | "editing";

export interface MenuImportEditableRow {
  rowNumber: number;
  values: Record<string, string>;
  status: MenuImportRowStatus;
  message: string | null;
  normalized: MenuImportRow | null;
}

export interface MenuImportPreview {
  columns: string[];
  rows: MenuImportEditableRow[];
  additions: MenuImportRow[];
  updates: MenuImportRow[];
  errors: { rowNumber: number; message: string }[];
  skips: { rowNumber: number; message: string }[];
}

export type AttendanceStatusOrNone = AttendanceStatus | "none";

export interface Attendance {
  id: string;
  schedule_id: string;
  user_id: string;
  status: AttendanceStatus;
  is_late: boolean;
  late_note: string | null;
  absence_note: string | null;
  created_at: string;
  updated_at: string;
}

/** 出席者の表示用 */
export interface Attendee {
  user_id: string;
  status: AttendanceStatus;
  is_late: boolean;
  late_note: string | null;
  absence_note: string | null;
  profile: AuthorMini;
}

export interface ScheduleWithMenus extends PracticeSchedule {
  menus: PracticeMenu[];
}

export interface PracticeMenu {
  id: string;
  schedule_id: string;
  author_id: string;
  group_name: string | null;
  /** メニュー本文 */
  content: string;
  /** 中長距離向け: ペース設定 */
  pace: string | null;
  /** 中長距離向け: 補足 */
  remark: string | null;
  /** 中長距離向け: 補強メニュー */
  supplement: string | null;
  target_block: Block | null;
  status: "draft" | "published";
  created_at: string;
  updated_at: string;
  author?: { id?: string; display_name: string } | null;
  targets?: PracticeMenuTarget[];
  /** DB保存ではなく月別スプレッドシートから直接表示しているメニュー */
  source?: "sheet";
}

export interface PracticeMenuTarget {
  menu_id: string;
  user_id: string;
  profile?: Pick<Profile, "id" | "display_name" | "avatar_url" | "blocks" | "grade"> | null;
}

export interface Notice {
  id: string;
  author_id: string;
  category: NoticeCategory;
  title: string;
  content: string;
  deadline: string | null;
  pin_home: boolean;
  notify_members: boolean;
  /** 旧通知先ロール列（mentioned_role_idsとの互換用）。 */
  target_role_ids: string[];
  mentioned_all: boolean;
  mentioned_role_ids: string[];
  mentioned_user_ids: string[];
  mentioned_excluded_user_ids: string[];
  mentioned_blocks: Block[];
  mentioned_grades: string[];
  created_at: string;
}

export interface NoticeWithReactions extends Notice {
  reaction_counts: Record<NoticeReaction, number>;
  my_reactions: NoticeReaction[];
}

export interface PbRecord {
  id: string;
  user_id: string;
  event_name: string;
  record: string;
  meet_name: string | null;
  recorded_on: string | null;
  is_pb: boolean;
  is_ub: boolean;
  is_official: boolean;
  created_at: string;
}

export interface WeeklyRankingRow {
  id: string;
  display_name: string;
  grade: string | null;
  blocks: Block[];
  avatar_url: string | null;
  km_low: number;
  km_mid: number;
  km_other: number;
  km_high: number;
  km_speed: number;
  total_km: number;
  period_start: string;
  period_end: string;
}

export interface NoteTheme {
  id: string;
  name: string;
  description: string | null;
  sort: number;
  created_by: string;
  created_at: string;
}

export interface NoteRow {
  id: string;
  author_id: string;
  /** 親フォルダ（NULL=ルート）。深さ3階層まで（UI側で制限） */
  parent_id: string | null;
  scope: NoteScope;
  theme_id: string | null;
  pinned: boolean;
  title: string;
  description: string | null;
  body: string;
  status: NoteStatus;
  edit_policy: NoteEditPolicy;
  created_at: string;
  updated_at: string;
}

export interface NoteWithRelations extends NoteRow {
  author: AuthorMini;
  theme: NoteTheme | null;
  editors?: { user_id: string; profile?: AuthorMini | null }[];
  articles?: { id: string }[];
}

export interface ThreadRow {
  id: string;
  folder_id: string | null;
  author_id: string;
  title: string;
  created_at: string;
  pinned: boolean;
  updated_at: string;
}

export interface ThreadWithAuthor extends ThreadRow {
  author: AuthorMini;
  posts?: { id: string }[];
}

export interface ThreadPostWithAuthor {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  author: AuthorMini;
}

export interface NoteArticleRow {
  id: string;
  pinned: boolean;
  note_id: string;
  author_id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface NoteArticleWithAuthor extends NoteArticleRow {
  author: AuthorMini;
}

/** フィード（タイムライン）用の合成型 */
export type FeedItem =
  | ({ kind: "record" } & RecordWithAuthor)
  | ({ kind: "tweet" } & TweetWithAuthor);

export type NotificationType = "comment" | "notice" | "schedule_update" | "sync_failure" | "thread_reply" | "mention";
export type NotificationReferenceType = "record" | "tweet" | "schedule" | "notice" | "thread";

export interface AppNotification {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: NotificationType;
  reference_type: NotificationReferenceType | null;
  reference_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface AppNotificationWithActor extends AppNotification {
  actor: Pick<Profile, "id" | "display_name" | "avatar_url"> | null;
}
