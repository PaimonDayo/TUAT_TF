export type ObEntry = {
  id: string; meet_key: string; submitted_name: string; grade: string; events: string[];
  profile_id: string | null; revision: number; imported_at: string;
  qualification_marks: Record<string, string | null>;
  competition_division?: "男子" | "女子" | null;
  /** Whole-meet absence is separate from an individual event's DNS. */
  absent?: boolean;
  /** Only for the existing workbook format; registration now belongs to one appearance. */
  canonical_appearance?: boolean;
};
import { compareObEvents } from "./ob-entry-edit";
export { entryGrade, matchEntryMember, normalizeEntryName, type EntryMember } from "./entry-identity";

export function isAlumniEntry(entry: Pick<ObEntry, "grade">) {
  return entry.grade === "OB・OG";
}

/** 種目を当日の実施順に並べ、自由記述を保持する。未回答とフォームに欄がない場合を区別する。 */
export function entryEventRows(entry: Pick<ObEntry, "events" | "qualification_marks">) {
  return [...entry.events].sort(compareObEvents).map((event) => ({ event, mark: Object.hasOwn(entry.qualification_marks, event)
    ? entry.qualification_marks[event]?.trim() || "未回答" : "記録欄なし" }));
}

/** A person's first appearance keeps its original UUID; the second has a stable slot. */
export function obAppearanceId(entryId: string, occurrence: number) { return occurrence === 2 ? `${entryId}:2` : entryId; }
export function obAppearanceEntryId(id: string) { return id.endsWith(":2") ? id.slice(0, -2) : id; }
export function obAppearanceNumber(id: string) { return id.endsWith(":2") ? 2 : 1; }
export function obEventCount(events: string[], event: string) { return events.filter(value => value === event).length; }
export function obAppearanceName(entry: Pick<ObEntry, "submitted_name" | "events"> | undefined, event: string, id: string) {
  const name = entry?.submitted_name ?? "登録解除済み";
  return obAppearanceNumber(id) === 2 || entry && obEventCount(entry.events, event) === 2 ? `${name}（${obAppearanceNumber(id)}件目）` : name;
}

export function entryAppearanceRows(entry: Pick<ObEntry, "events" | "qualification_marks">) {
  const counts = new Map<string, number>();
  return entryEventRows(entry).map(row => { const occurrence = (counts.get(row.event) ?? 0) + 1; counts.set(row.event, occurrence); return { ...row, occurrence }; });
}
