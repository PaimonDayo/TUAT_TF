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
 * スプレッドシート由来の記録を、タイムラインで「いつ投稿されたもの」として扱うか。
 *
 * **取り込んだ時刻**を使う（オーナー指示 2026-09-13）。同期は毎晩JST 0時に走るので、
 * その晩に入った分がタイムラインの一番上に出る。
 *
 * 2026-07-12から2026-09-13までは「練習日の0時(JST)」にしていた。当時は数日ぶんを
 * まとめて取り込むことがあり、取込時刻にすると毎回先頭が団子になって荒れたため。
 * 毎晩1日ぶんずつ入る今の運用ではその問題が起きないので戻した。
 *
 * 同じ取り込みに複数日ぶんが混ざったときは、練習日が新しいものほど上に来るように
 * ミリ秒だけずらす（人の目には同時刻のまま。並びが毎回変わるのを防ぐだけ）。
 */
export function sheetRecordCreatedAt(recordedDate: string, importedAt: Date = new Date()): string {
  const daysBehind = Math.round(
    (Date.parse(`${todayJST()}T00:00:00+09:00`) - Date.parse(`${recordedDate}T00:00:00+09:00`)) /
      86_400_000,
  );
  // 未来日や極端に古い日で時刻が飛ばないよう、ずらし幅は0〜1秒に収める。
  const nudgeMs = Math.min(Math.max(daysBehind, 0), 1000);
  return new Date(importedAt.getTime() - nudgeMs).toISOString();
}
