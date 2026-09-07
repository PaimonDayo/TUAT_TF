import { EVENTS_BY_BLOCK } from "./constants";
export type GoalDraft = { event: string; target: string };
export type EventOrder = "standard" | "middle_long" | "short";
export type CompetitionEvent = { name: string; sort_order: number };
/** Block preference changes priority, never removes another block's events. */
export function orderCompetitionEvents<T extends CompetitionEvent>(
  events: T[],
  order: EventOrder,
): T[] {
  const preferred = new Set(
    order === "middle_long"
      ? [...EVENTS_BY_BLOCK.middle_long, "5000mW", "10000mW"]
      : order === "short"
        ? [
            ...EVENTS_BY_BLOCK.short,
            ...EVENTS_BY_BLOCK.jump,
            ...EVENTS_BY_BLOCK.throw,
            "七種競技",
            "十種競技",
          ]
        : [],
  );
  return [...events].sort(
    (a, b) =>
      Number(preferred.has(b.name)) - Number(preferred.has(a.name)) ||
      a.sort_order - b.sort_order ||
      a.name.localeCompare(b.name, "ja"),
  );
}
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
