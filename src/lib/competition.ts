/** Calendar dates, not elapsed 24-hour periods; the whole competition is zero. */
export function competitionDays(startsOn: string, today: string, endsOn?: string | null): number {
  const lastDay = endsOn ?? startsOn;
  if (today >= startsOn && today <= lastDay) return 0;
  return Math.round(
    (Date.parse(startsOn + "T00:00:00+09:00") -
      Date.parse(today + "T00:00:00+09:00")) /
      86_400_000,
  );
}
