export type GoalDraft = { event: string; target: string };
export type CompetitionEvent = { name: string; sort_order: number };
/** Use the system's catalog order in every block. */
export function sortCompetitionEvents<T extends CompetitionEvent>(
  events: T[],
): T[] {
  return [...events].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ja"),
  );
}
/** Validate the whole batch before making a single atomic write. */
export function normalizeGoalDrafts(drafts: GoalDraft[]) {
  const rows = drafts.map((row) => ({
    event: row.event.trim(),
    target: row.target.trim(),
  }));
  if (!rows.length || rows.some((row) => !row.event || !row.target))
    throw new Error("各種目と目標を入力してください");
  if (rows.some((row) => row.target.length > 300))
    throw new Error("目標は300文字以内で入力してください");
  if (new Set(rows.map((row) => row.event)).size !== rows.length)
    throw new Error("同じ種目が重複しています");
  return rows;
}
