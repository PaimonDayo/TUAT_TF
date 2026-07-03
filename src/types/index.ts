// ─────────────────────────────────────────────
// 全型定義
// ─────────────────────────────────────────────

export type Block = "middle_long" | "short" | "jump" | "throw";
/** 旧・単一ロール（profiles.role 列。互換目的で残置） */
export type Role = "admin" | "menu_staff" | "member";
export type ProfileStatus = "active" | "graduated";

/** 権限の種類 */
export type Permission =
  | "manage_system" // システム管理（最上位権限）
  | "manage_members" // 部員・ロール管理
  | "create_schedule" // 練習予定の作成
  | "create_menu" // 練習メニューの作成
  | "create_notice"; // お知らせの作成

/** カスタムロール（roles テーブル） */
export interface AppRole {
  id: string;
  name: string;
  can_manage_system: boolean;
  can_manage_members: boolean;
  can_create_schedule: boolean;
  can_create_menu: boolean;
  can_create_notice: boolean;
  is_system: boolean;
  color: string;
  /** 表示上のカテゴリ（フォルダ分け。任意） */
  category: string | null;
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
export type NoteScope = "shared" | "personal";
export type NoteStatus = "draft" | "published";
export type NoteEditPolicy = "everyone" | "specified" | "author";

export interface Profile {
  id: string;
  email: string;
  display_name: string;
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
  /** 旧・利用承認フラグ（承認ゲートは廃止済みで常にtrue。列は互換のため残置） */
  approved: boolean;
  notify_comment: boolean;
  notify_notice: boolean;
  menu_view_all_blocks: boolean;
  /** スプレッドシート同期で使う、自分のシート名（例: B2駒井）。未設定なら同期対象外 */
  sheet_name: string | null;
  /** 記録の入力元。'sheet'ならスプシが正でアプリは閲覧専用、'app'ならアプリが正でスプシへ書き戻す */
  record_source: "app" | "sheet";
  /** 記録フォームのカスタム項目定義（短距離など独自列の人向け） */
  record_fields: RecordFieldDef[];
  created_at: string;
}

/** ユーザーが追加できる記録フォームのカスタム項目 */
export interface RecordFieldDef {
  /** 安定したキー（custom JSONB のキーになる） */
  key: string;
  /** 表示ラベル */
  label: string;
  type: "text" | "number";
}

/** 投稿カードに埋め込む投稿者の最小情報 */
export type AuthorMini = Pick<
  Profile,
  "id" | "display_name" | "avatar_url" | "blocks" | "grade"
>;

export interface PracticeRecord {
  id: string;
  user_id: string;
  recorded_date: string;
  dist_low: number;
  dist_mid: number;
  dist_high: number;
  dist_speed: number;
  strides: number;
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
}

export interface TweetWithAuthor extends Tweet {
  author: AuthorMini;
  liked_by_me?: boolean;
  comments_count?: number;
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
  created_at: string;
  updated_at: string;
}

export type CommentAuthor = Pick<Profile, "id" | "display_name" | "avatar_url">;

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
  created_at: string;
  updated_at: string;
}

/** 出席者の表示用 */
export interface Attendee {
  user_id: string;
  status: AttendanceStatus;
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
  /** 空配列は全部員。値がある場合は該当ロールの部員だけへ通知する。 */
  target_role_ids: string[];
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
  scope: NoteScope;
  theme_id: string | null;
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

export interface NoteArticleRow {
  id: string;
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

export type NotificationType = "comment" | "notice";
export type NotificationReferenceType = "record" | "tweet" | "notice";

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
