/** 大会の開催日（初日〜最終日、YYYY-MM-DD）。最終日が無い・初日より前なら初日だけ。長すぎる期間は14日で打ち切る。 */
export function competitionDays(startsOn: string, endsOn: string | null | undefined): string[] {
  const days = [startsOn];
  if (!endsOn || endsOn <= startsOn) return days;
  const cursor = new Date(`${startsOn}T00:00:00Z`);
  while (days.length < 14) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.toISOString().slice(0, 10);
    if (day > endsOn) break;
    days.push(day);
  }
  return days;
}

/** 大会名の比べ方（全角半角・空白の違いは同じとみなす） */
export function sameMeetName(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined) => (v ?? "").normalize("NFKC").replace(/\s+/gu, "");
  return !!norm(a) && norm(a) === norm(b);
}

/**
 * 大会を選ばずに大会名を自由入力した結果を、その大会の結果とみなすか。
 * 名前が一致し、記録日（日まで入っているもの）が大会の開催日のどれかと一致するときだけ（2026-09-26 オーナー確定）。
 */
export function isTypedResultOf(
  result: { meet_name: string | null; recorded_on: string | null; date_precision?: string | null },
  competition: { name: string; starts_on: string; ends_on: string | null },
): boolean {
  return sameMeetName(result.meet_name, competition.name) && !!result.recorded_on &&
    (result.date_precision ?? "day") === "day" && competitionDays(competition.starts_on, competition.ends_on).includes(result.recorded_on);
}
