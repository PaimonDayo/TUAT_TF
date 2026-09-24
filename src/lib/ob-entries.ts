export type ObEntry = {
  id: string; meet_key: string; submitted_name: string; grade: string; events: string[];
  profile_id: string | null; revision: number; imported_at: string;
  qualification_marks: Record<string, string | null>;
};
export { entryGrade, matchEntryMember, normalizeEntryName, type EntryMember } from "./entry-identity";

/** 種目の回答順と自由記述を保持する。未回答とフォームに欄がない場合を区別する。 */
export function entryEventRows(entry: Pick<ObEntry, "events" | "qualification_marks">) {
  return entry.events.map((event) => ({ event, mark: Object.hasOwn(entry.qualification_marks, event)
    ? entry.qualification_marks[event]?.trim() || "未回答" : "記録欄なし" }));
}
