export type ObEntry = {
  id: string; meet_key: string; submitted_name: string; grade: string; events: string[];
  profile_id: string | null; revision: number; imported_at: string;
};
export type EntryMember = { id: string; display_name: string; grade: string | null };

export function normalizeEntryName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/gu, "");
}

export function entryGrade(grade: string | null): string {
  const text = (grade ?? "").normalize("NFKC").trim().toUpperCase();
  return /^[1-4]$/.test(text) ? `B${text}` : text;
}

/** 候補提示のみ。表記が一致してもユーザーIDは人が確認してから保存する。 */
export function matchEntryMember(entry: Pick<ObEntry, "submitted_name" | "grade">, members: EntryMember[]) {
  const name = normalizeEntryName(entry.submitted_name);
  const candidates = name ? members.filter((m) => normalizeEntryName(m.display_name) === name) : [];
  const sameGrade = candidates.filter((m) => entryGrade(m.grade) === entryGrade(entry.grade));
  return {
    candidates: sameGrade.length ? sameGrade : candidates,
    status: candidates.length === 0 ? "none" : candidates.length > 1 ? "ambiguous" : sameGrade.length === 1 ? "exact" : "grade_check",
  } as const;
}
