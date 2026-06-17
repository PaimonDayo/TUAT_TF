import type { Block, Role, Condition, Intensity, ScheduleType, NoticeCategory } from "@/types";

/** ブロック定義 */
export const BLOCKS: Record<
  Block,
  { label: string; short: string; color: string; bg: string }
> = {
  middle_long: { label: "中長距離", short: "中長", color: "#34c759", bg: "#e5f7f0" },
  short: { label: "短距離", short: "短", color: "#ff9500", bg: "#fff4e5" },
  jump: { label: "跳躍", short: "跳", color: "#af52de", bg: "#f2eeff" },
  throw: { label: "投擲", short: "投", color: "#ff3b30", bg: "#ffe5e5" },
};

export const BLOCK_ORDER: Block[] = ["middle_long", "short", "jump", "throw"];

/** ロール定義 */
export const ROLES: Record<Role, { label: string }> = {
  admin: { label: "管理者" },
  menu_staff: { label: "メニュー担当" },
  member: { label: "一般部員" },
};

/** 強度別ラベル（中長距離の距離入力） */
export const INTENSITY_LABELS: Record<
  Intensity,
  { label: string; sub: string; color: string; field: string }
> = {
  low: { label: "低強度", sub: "jog–E", color: "#007aff", field: "dist_low" },
  mid: { label: "中強度", sub: "M–LT", color: "#34c759", field: "dist_mid" },
  high: { label: "高強度", sub: "CV–VO2", color: "#ff9500", field: "dist_high" },
  speed: { label: "解糖系", sub: "スピード", color: "#ff3b30", field: "dist_speed" },
};

export const INTENSITY_ORDER: Intensity[] = ["low", "mid", "high", "speed"];

/** コンディション（◎◯△の3段階） */
export const CONDITIONS: Record<Condition, { label: string; symbol: string; color: string }> = {
  great: { label: "好調", symbol: "◎", color: "#34c759" },
  normal: { label: "普通", symbol: "◯", color: "#8e8e93" },
  bad: { label: "不調", symbol: "△", color: "#ff3b30" },
};

export const CONDITION_ORDER: Condition[] = ["great", "normal", "bad"];

/** 練習予定の種別（大会と行事は「大会・行事」に統合） */
export const SCHEDULE_TYPES: Record<ScheduleType, { label: string; color: string }> = {
  practice: { label: "練習", color: "#007aff" },
  meet: { label: "大会・行事", color: "#ff3b30" },
  event: { label: "大会・行事", color: "#ff3b30" }, // 旧データ互換（UIには出さない）
  time_trial: { label: "記録会", color: "#af52de" },
};

/** 予定作成フォームで選べる種別 */
export const SCHEDULE_TYPE_OPTIONS: { key: ScheduleType; label: string }[] = [
  { key: "practice", label: "練習" },
  { key: "meet", label: "大会・行事" },
  { key: "time_trial", label: "記録会" },
];

/** 出欠を取る種別（記録会は対象外） */
export const ATTENDANCE_TYPES: ScheduleType[] = ["practice", "meet", "event"];

/** エントリー期間を持ちうる種別 */
export const ENTRY_PERIOD_TYPES: ScheduleType[] = ["meet", "time_trial"];

/** お知らせカテゴリ */
export const NOTICE_CATEGORIES: Record<NoticeCategory, { label: string; color: string; bg: string }> = {
  fee: { label: "部費", color: "#ff9500", bg: "#fff4e5" },
  entry: { label: "エントリー", color: "#007aff", bg: "#e5f0ff" },
  info: { label: "お知らせ", color: "#8e8e93", bg: "#f2f2f7" },
  rule: { label: "ルール", color: "#af52de", bg: "#f2eeff" },
};

/** 学年（学部1〜4年 / 修士 M1・M2 / 博士 D1〜D3） */
export const GRADE_OPTIONS: { value: string; label: string; short: string }[] = [
  { value: "1", label: "学部1年", short: "1年" },
  { value: "2", label: "学部2年", short: "2年" },
  { value: "3", label: "学部3年", short: "3年" },
  { value: "4", label: "学部4年", short: "4年" },
  { value: "M1", label: "修士1年", short: "M1" },
  { value: "M2", label: "修士2年", short: "M2" },
  { value: "D1", label: "博士1年", short: "D1" },
  { value: "D2", label: "博士2年", short: "D2" },
  { value: "D3", label: "博士3年", short: "D3" },
];

/** grade 値を短い表示名に（"1"→"1年", "M1"→"M1"） */
export function gradeShort(grade: string | null): string | null {
  if (!grade) return null;
  return GRADE_OPTIONS.find((g) => g.value === grade)?.short ?? grade;
}
