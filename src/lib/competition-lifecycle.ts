type Lifecycle = { archive_at?: string | null };

/** 指定時刻以降は保存済みの大会として扱う。データは削除しない。 */
export function isCompetitionArchived(competition: Lifecycle, now = Date.now()): boolean {
  return Boolean(competition.archive_at && Date.parse(competition.archive_at) <= now);
}

export function selectHomeCompetition<T extends Lifecycle & { is_countdown: boolean; starts_on: string; ends_on: string | null }>(
  competitions: T[], now = Date.now(),
): T | null {
  const active = competitions.filter((c) => !isCompetitionArchived(c, now));
  const selected = active.find((c) => c.is_countdown);
  if (selected) return selected;
  // 明示的なホーム選択を解除した場合は自動選択しない。
  if (!competitions.some((c) => c.is_countdown && isCompetitionArchived(c, now))) return null;
  const today = new Date(now).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  return active.filter((c) => (c.ends_on ?? c.starts_on) >= today)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0] ?? null;
}
