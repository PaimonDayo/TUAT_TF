import type { SheetTransition } from "./sheet-period";

/** 設定の選択肢・現在値・説明で、同じ入力方法を同じ名前で表示する。 */
export const SHEET_INPUT_MODE_LABELS: Record<SheetTransition["mode"], string> = {
  sheet: "スプレッドシートとアプリの両方から入力",
  app_only: "アプリからのみ入力",
  off: "スプレッドシートと連携しない",
};
