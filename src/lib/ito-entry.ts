import type { AppRole, ItoGameMode, ItoGameStatus, ItoInvitationStatus } from "@/types";
import { hasPermission } from "@/lib/permissions";

/**
 * ito のゲーム作成とエントリー（docs/ITO-PLAN.md §2.1・§3）。
 * 対象者の決め方と集計はここに集約し、サーバーアクションからも画面からも同じ結果を使う。
 */

export const ITO_GAME_NAME_MAX = 60;
export const ITO_GAME_THEME_MAX = 60;

/**
 * 削除してよいゲームの状態。進行中（エントリー受付・進行中）のゲームは、
 * 終了してからでないと消せない。
 */
export const ITO_DELETABLE_STATUSES: ItoGameStatus[] = ["draft", "finished"];

/**
 * モードごとの1グループの最少人数。
 * team: 代表者1＋通常回答者1以上。solo: 代表のみのグループ（回答者なし）を認める。
 */
export const ITO_GAME_MIN_GROUP_SIZE: Record<ItoGameMode, number> = {
  team: 2,
  solo: 1,
};

export const ITO_GAME_MODE_LABELS: Record<ItoGameMode, string> = {
  team: "チーム戦（代表者+回答者）",
  solo: "ソロ / 代表のみ",
};

export interface ItoGameFormValues {
  name: string;
  targetRoleId: string | null;
  /** 省略時は team（既存挙動）。 */
  mode?: ItoGameMode;
  groupCount: number;
  maxGroupSize: number;
  /** お題。空なら未設定。 */
  theme?: string;
  /** 進行役のシステム管理者もこのゲームに参加するか。 */
  adminParticipates?: boolean;
}

export type ItoGameFormErrorField =
  | "name"
  | "targetRoleId"
  | "groupCount"
  | "maxGroupSize"
  | "theme";

export interface ItoGameFormError {
  field: ItoGameFormErrorField;
  message: string;
}

/** ゲーム作成フォームの検証。人数の充足はエントリー締切後に別途確認する。 */
export function validateItoGameForm(values: ItoGameFormValues): ItoGameFormError[] {
  const errors: ItoGameFormError[] = [];
  const name = values.name.trim();
  const mode: ItoGameMode = values.mode ?? "team";
  const minGroupSize = ITO_GAME_MIN_GROUP_SIZE[mode];

  if (!name) {
    errors.push({ field: "name", message: "ゲーム名を入力してください。" });
  } else if (name.length > ITO_GAME_NAME_MAX) {
    errors.push({
      field: "name",
      message: `ゲーム名は${ITO_GAME_NAME_MAX}文字までにしてください。`,
    });
  }
  if (!values.targetRoleId) {
    errors.push({ field: "targetRoleId", message: "参加対象のロールを選んでください。" });
  }
  if (!Number.isInteger(values.groupCount) || values.groupCount < 2) {
    errors.push({ field: "groupCount", message: "グループ数は2つ以上にしてください。" });
  }
  if (!Number.isInteger(values.maxGroupSize) || values.maxGroupSize < minGroupSize) {
    errors.push({
      field: "maxGroupSize",
      message: `1グループの最大人数は${minGroupSize}人以上にしてください。`,
    });
  }
  if ((values.theme ?? "").trim().length > ITO_GAME_THEME_MAX) {
    errors.push({
      field: "theme",
      message: `テーマは${ITO_GAME_THEME_MAX}文字までにしてください。`,
    });
  }
  return errors;
}

export interface ItoTargetCandidate {
  id: string;
  roles: AppRole[];
}

/**
 * 招待の対象者を決める。
 * - 指定ロールを持つ部員（全員ロールは全部員が対象）
 * - 進行役（システム管理権限の保持者）は進行専任なので外す
 * - ただし includeProfileIds に挙げた人（参加を選んだ進行役本人）は、
 *   ロール・管理権限の判定に関わらず対象に含める
 * - 同じラウンドで既に招待済みの人は重複させない
 */
export function itoInviteTargets<T extends ItoTargetCandidate>(params: {
  candidates: T[];
  targetRoleId: string;
  alreadyInvitedIds?: string[];
  includeProfileIds?: string[];
}): T[] {
  const invited = new Set(params.alreadyInvitedIds ?? []);
  const include = new Set(params.includeProfileIds ?? []);
  return params.candidates.filter((candidate) => {
    if (invited.has(candidate.id)) return false;
    if (include.has(candidate.id)) return true;
    if (hasPermission(candidate.roles, "manage_system")) return false;
    return candidate.roles.some((role) => role.id === params.targetRoleId);
  });
}

export interface ItoEntryCounts {
  /** 招待した人数 */
  target: number;
  joined: number;
  declined: number;
  pending: number;
}

/** エントリー状況の集計。未回答は明示辞退と混ぜない。 */
export function itoEntryCounts(
  invitations: { status: ItoInvitationStatus }[],
): ItoEntryCounts {
  const counts: ItoEntryCounts = { target: 0, joined: 0, declined: 0, pending: 0 };
  for (const invitation of invitations) {
    counts.target += 1;
    counts[invitation.status] += 1;
  }
  return counts;
}

/**
 * 参加人数に対してグループ設定が成り立つか。
 * ラウンド開始前の警告に使う（実際の編成時は validateItoGrouping が最終判定）。
 */
export function itoCapacityWarning(params: {
  joined: number;
  groupCount: number;
  maxGroupSize: number;
  /** 省略時は team（既存挙動）。 */
  mode?: ItoGameMode;
}): string | null {
  const minGroupSize = ITO_GAME_MIN_GROUP_SIZE[params.mode ?? "team"];
  const capacity = params.groupCount * params.maxGroupSize;
  if (params.joined > capacity) {
    return `参加${params.joined}人に対して収容できるのは${capacity}人までです。グループ数か最大人数を増やしてください。`;
  }
  if (params.joined < params.groupCount * minGroupSize) {
    return `各グループを${minGroupSize}人以上にするには${params.groupCount * minGroupSize}人必要です（現在${params.joined}人）。グループ数を減らすか、参加者を増やしてください。`;
  }
  return null;
}
