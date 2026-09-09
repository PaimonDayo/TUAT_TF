/** 出欠を取る日の上限。データが壊れていても画面が無限に伸びないようにする。 */
export const MAX_ATTENDANCE_DAYS = 31;

/**
 * 予定の出欠を取る日の一覧（JSTの暦日）。
 * 単日の予定はその日だけ、複数日開催（大会など）は初日から最終日まで。
 * 終了日が初日より前など、ありえない値は初日だけを返す。
 */
export function scheduleAttendanceDates(
  startDate: string,
  endDate: string | null,
): string[] {
  if (!endDate || endDate <= startDate) return [startDate];
  const days: string[] = [];
  const last = Date.parse(`${endDate}T00:00:00Z`);
  let cursor = Date.parse(`${startDate}T00:00:00Z`);
  if (Number.isNaN(cursor) || Number.isNaN(last)) return [startDate];
  while (cursor <= last && days.length < MAX_ATTENDANCE_DAYS) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return days;
}

/**
 * 複数日開催のうち、いま出欠を出す対象として最初に見せる日。
 * まだ終わっていない最初の日。全部終わっていれば最終日。
 */
export function currentAttendanceDate(days: string[], today: string): string {
  return days.find((day) => day >= today) ?? days[days.length - 1];
}
