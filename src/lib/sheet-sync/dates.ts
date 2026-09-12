// 同期対象期間とタイムラインの並び順に使う日付の決まり。



// 現行スプレッドシートの開始日。初回だけここから全履歴を取り込み、以後は直近1か月に絞る。
export const SHEET_HISTORY_START = "2026-03-23";
export function todayJST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** 初回は全履歴、完了後は同日の1か月前からを同期対象にする。 */
export function sheetPullCutoff(today: string, historyImportedAt: string | null): string {
  if (!historyImportedAt) return SHEET_HISTORY_START;
  const [year, month, day] = today.split("-").map(Number);
  const targetMonthIndex = month - 2;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(targetYear, normalizedMonthIndex, Math.min(day, lastDay)));
  return date.toISOString().slice(0, 10);
}

/**
 * Sheet-imported records use the practice date, never the time they were imported.
 * Otherwise, importing old records incorrectly moves them to the top of the timeline.
 */
export function sheetRecordCreatedAt(recordedDate: string): string {
  return recordedDate + "T00:00:00+09:00";
}
