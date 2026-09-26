export type ObEntry = {
  id: string; meet_key: string; submitted_name: string; grade: string; events: string[];
  profile_id: string | null; revision: number; imported_at: string;
  qualification_marks: Record<string, string | null>;
  competition_division?: "男子" | "女子" | null;
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
