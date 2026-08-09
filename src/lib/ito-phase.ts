import type { ItoGameStatus, ItoPhase } from "@/types";

/**
 * ito の状態遷移。ゲーム全体（ItoGameStatus）とラウンド内（ItoPhase）を分けて持つ。
 * ここの許可表は supabase/migrations/20260810010000_ito_game.sql の
 * ito_advance_phase() と同じ内容でなければならない（テストで固定している）。
 * クライアントは表示制御にだけ使い、実際の遷移はサーバー側で検証する。
 */

export const ITO_PHASE_ORDER: ItoPhase[] = [
  "grouping",
  "leader_select",
  "numbers",
  "leader_answers",
  "ordering",
  "locked",
  "revealed",
  "result",
  "finished",
];

export const ITO_PHASE_LABELS: Record<ItoPhase, string> = {
  grouping: "グループ編成",
  leader_select: "代表者選択",
  numbers: "秘密数字の配布",
  leader_answers: "代表者の回答入力",
  ordering: "回答受付中",
  locked: "回答受付終了",
  revealed: "予想公開",
  result: "結果発表",
  finished: "ラウンド終了",
};

/** 各フェーズから進める先。locked → ordering だけが後戻りとして許される。 */
export const ITO_PHASE_TRANSITIONS: Record<ItoPhase, ItoPhase[]> = {
  grouping: ["leader_select"],
  leader_select: ["numbers"],
  numbers: ["leader_answers"],
  leader_answers: ["ordering"],
  ordering: ["locked"],
  locked: ["revealed", "ordering"],
  revealed: ["result"],
  result: ["finished"],
  finished: [],
};

/** 元に戻せない操作。管理者に確認ダイアログを出す対象。 */
export const ITO_IRREVERSIBLE_PHASES: ItoPhase[] = [
  "numbers",
  "revealed",
  "result",
];

export const ITO_GAME_STATUS_LABELS: Record<ItoGameStatus, string> = {
  draft: "ゲーム作成",
  entry: "エントリー受付",
  active: "進行中",
  finished: "ゲーム終了",
};

export const ITO_GAME_STATUS_TRANSITIONS: Record<ItoGameStatus, ItoGameStatus[]> = {
  draft: ["entry"],
  entry: ["active"],
  active: ["finished"],
  finished: [],
};

export function canAdvanceItoPhase(from: ItoPhase, to: ItoPhase): boolean {
  return ITO_PHASE_TRANSITIONS[from].includes(to);
}

/** 通常の「次へ」。後戻り（locked → ordering）は含めない。 */
export function nextItoPhase(from: ItoPhase): ItoPhase | null {
  const index = ITO_PHASE_ORDER.indexOf(from);
  if (index < 0 || index === ITO_PHASE_ORDER.length - 1) return null;
  const next = ITO_PHASE_ORDER[index + 1];
  return canAdvanceItoPhase(from, next) ? next : null;
}

export function canAdvanceItoGameStatus(
  from: ItoGameStatus,
  to: ItoGameStatus,
): boolean {
  return ITO_GAME_STATUS_TRANSITIONS[from].includes(to);
}

/** 参加者が並び順を編集できるフェーズか（提出後も受付終了までは編集できる） */
export function isItoAnswerEditable(phase: ItoPhase): boolean {
  return phase === "ordering";
}

/** 他グループの予想まで見えるフェーズか */
export function isItoPredictionVisible(phase: ItoPhase): boolean {
  return phase === "revealed" || phase === "result" || phase === "finished";
}

/** 秘密数字と正解を出してよいフェーズか */
export function isItoResultVisible(phase: ItoPhase): boolean {
  return phase === "result" || phase === "finished";
}
