export type EntryMember = { id: string; display_name: string; grade: string | null };
export type ConfirmedEntryIdentity = { submitted_name: string; profile_id: string };
export type EntryIdentityInput = { submitted_name: string; grade: string };

export function normalizeEntryName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/gu, "");
}

export function entryGrade(grade: string | null): string {
  const text = (grade ?? "").normalize("NFKC").trim().toUpperCase();
  return /^[1-4]$/.test(text) ? `B${text}` : text;
}

/** 大会やフォームに依存しない候補提示。過去の確認結果も自動確定には使わない。 */
export function matchEntryMember(entry: EntryIdentityInput, members: EntryMember[], history: ConfirmedEntryIdentity[] = []) {
  const name = normalizeEntryName(entry.submitted_name);
  const previousIds = new Set(history.filter((h) => name && normalizeEntryName(h.submitted_name) === name).map((h) => h.profile_id));
  const candidates = name ? members.filter((m) => normalizeEntryName(m.display_name) === name || previousIds.has(m.id)) : [];
  const sameGrade = candidates.filter((m) => entryGrade(m.grade) === entryGrade(entry.grade));
  return {
    candidates: [...sameGrade, ...candidates.filter((m) => !sameGrade.includes(m))],
    status: candidates.length === 0 ? "none" : candidates.length > 1 ? "ambiguous" : previousIds.has(candidates[0].id) ? "previous" : sameGrade.length === 1 ? "exact" : "grade_check",
  } as const;
}
