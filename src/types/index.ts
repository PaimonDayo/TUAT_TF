// ─────────────────────────────────────────────
// 全型定義
// ─────────────────────────────────────────────

export type Block = "middle_long" | "short" | "jump" | "throw";
/** 旧・単一ロール（profiles.role 列。互換目的で残置） */
export type Role = "admin" | "menu_staff" | "member";
export type ProfileStatus = "active" | "graduated";

/** 権限の種類 */
export type Permission =
  | "manage_members" // 部員・ロール管理
  | "create_schedule" // 練習予定の作成
  | "create_menu" // 練習メニューの作成
  | "create_notice"; // お知らせの作成

/** カスタムロール（roles テーブル） */
export interface AppRole {
  id: string;
  name: string;
  can_manage_members: boolean;
  can_create_schedule: boolean;
  can_create_menu: boolean;
  can_create_notice: boolean;
  is_system: boolean;
  color: string;
  sort_order: number;
  created_at: string;
}
export type Condition = "great" | "normal" | "bad";
export type Intensity = "low" | "mid" | "high" | "speed";
export type ScheduleType = "practice" | "meet" | "event" | "time_trial";
export type NoticeCategory = "fee" | "entry" | "info" | "rule";
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
  created_at: string;
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

export interface ScheduleImportPreview {
  additions: ScheduleImportRow[];
  updates: ScheduleImportRow[];
  deletions: PracticeSchedule[];
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
  content: string;
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

export interface MenuTargetPreset {
  id: string;
  author_id: string;
  name: string;
  user_ids: string[];
  created_at: string;
}

export interface Notice {
  id: string;
  author_id: string;
  category: NoticeCategory;
  title: string;
  content: string;
  deadline: string | null;
  pin_home: boolean;
  created_at: string;
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
