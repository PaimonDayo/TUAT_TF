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

/** Blocks that can be selected in profile editing. Jump and throw are legacy values. */
export const EDITABLE_BLOCK_ORDER: Block[] = ["middle_long", "short"];
export const PROFILE_BLOCK_ORDER = EDITABLE_BLOCK_ORDER;

export type SimpleBlock = "middle_long" | "short";

/** Convert one legacy membership to the active short-distance block. */
export function normalizeBlock(block: Block): SimpleBlock {
  return block === "jump" || block === "throw" ? "short" : block;
}

/** Treat legacy jump/throw memberships as short-distance membership. */
export function normalizeProfileBlocks(
  blocks: Block[] | undefined | null,
): Block[] {
  const normalized = (blocks ?? []).map(normalizeBlock);
  return Array.from(new Set(normalized));
}

/** One stable attendance group per member, based on the first membership. */
export function primarySimpleBlock(
  blocks: Block[] | undefined | null,
): SimpleBlock | null {
  const primary = blocks?.[0];
  if (primary === "middle_long") return "middle_long";
  if (primary === "short" || primary === "jump" || primary === "throw") {
    return "short";
  }
  return null;
}

/** 専門種目の選択肢（ブロック別）。プロフィールの「専門種目」入力に使う。 */
export const EVENTS_BY_BLOCK: Record<Block, string[]> = {
  middle_long: [
    "800m",
    "1500m",
    "3000m",
    "3000mSC",
    "5000m",
    "10000m",
    "ハーフ",
    "マラソン",
    "駅伝",
  ],
  short: [
    "100m",
    "200m",
    "400m",
    "100mH",
    "110mH",
    "400mH",
    "4×100mR",
    "4×400mR",
  ],
  jump: ["走高跳", "走幅跳", "三段跳", "棒高跳"],
  throw: ["砲丸投", "円盤投", "ハンマー投", "やり投"],
};

/** 簡素化したブロック絞り込み（中長 / 短。跳躍・投擲は「短」に含める） */
export type SimpleBlockFilter = "all" | SimpleBlock;

export const SIMPLE_BLOCK_ITEMS: { key: SimpleBlockFilter; label: string }[] = [
  { key: "all", label: "全体" },
  { key: "middle_long", label: "中長距離" },
  { key: "short", label: "短距離" },
];

/** プロフィールの所属ブロックが、簡素化フィルタ（all/middle_long/short）に合致するか */
export function matchSimpleBlock(
  blocks: Block[] | undefined | null,
  filter: string,
): boolean {
  if (filter === "all") return true;
  if (filter === "middle_long") return (blocks ?? []).includes("middle_long");
  if (filter === "short")
    return (blocks ?? []).some((b) => b === "short" || b === "jump" || b === "throw");
  return true;
}

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
  { value: "1", label: "学部1年", short: "B1" },
  { value: "2", label: "学部2年", short: "B2" },
  { value: "3", label: "学部3年", short: "B3" },
  { value: "4", label: "学部4年", short: "B4" },
  { value: "M1", label: "修士1年", short: "M1" },
  { value: "M2", label: "修士2年", short: "M2" },
  { value: "D1", label: "博士1年", short: "D1" },
  { value: "D2", label: "博士2年", short: "D2" },
  { value: "D3", label: "博士3年", short: "D3" },
];

/** grade 値を短い表示名に（"1"→"B1", "M1"→"M1"） */
export function gradeShort(grade: string | null): string | null {
  if (!grade) return null;
  return GRADE_OPTIONS.find((g) => g.value === grade)?.short ?? grade;
}
