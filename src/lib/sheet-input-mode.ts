import { SHEET_SETUP_RECONFIRM_AFTER, type SheetTransition } from "./sheet-period";

/** 設定の選択肢・現在値・説明で、同じ入力方法を同じ名前で表示する。 */
export const SHEET_INPUT_MODE_LABELS: Record<SheetTransition["mode"], string> = {
  sheet: "スプレッドシートとアプリの両方から入力",
  app_only: "アプリからのみ入力",
  off: "スプレッドシートと連携しない",
};

export type SheetLinkStatus = "linked" | "off" | "unset" | "needs_confirmation" | "ended";

export const SHEET_LINK_STATUS_LABELS: Record<SheetLinkStatus, string> = {
  linked: "連携中",
  off: "連携なし",
  unset: "未設定",
  needs_confirmation: "要確認",
  ended: "連携終了",
};

/** 一覧では現在の設定だけを参照し、過去の項目定義を読み込まず連携状態を判定する。 */
export function sheetLinkStatus({ version, mode, confirmed_at, sheet_name }: {
  version?: unknown;
  mode?: unknown;
  confirmed_at?: unknown;
  sheet_name?: string | null;
}): Exclude<SheetLinkStatus, "ended"> {
  if (version !== "2026-10" || (mode !== "sheet" && mode !== "app_only" && mode !== "off")) return "unset";
  if (mode !== "off" && !sheet_name?.trim()) return "unset";
  const confirmedAt = typeof confirmed_at === "string" ? Date.parse(confirmed_at) : NaN;
  if (!Number.isFinite(confirmedAt) || confirmedAt < Date.parse(SHEET_SETUP_RECONFIRM_AFTER)) return "needs_confirmation";
  return mode === "off" ? "off" : "linked";
}
