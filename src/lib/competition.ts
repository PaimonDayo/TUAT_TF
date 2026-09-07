export const HOME_COMPETITION_ID = "27-universities-2026";
/** Calendar dates, not elapsed 24-hour periods; the first day is exactly zero. */
export function competitionDays(startsOn: string, today: string): number {
  return Math.round(
    (Date.parse(startsOn + "T00:00:00+09:00") -
      Date.parse(today + "T00:00:00+09:00")) /
      86_400_000,
  );
}
