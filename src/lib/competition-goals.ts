export type GoalDraft = { event: string; target: string };
/** Validate the whole batch before making a single atomic upsert. */
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
