import { GRADE_OPTIONS } from "@/lib/constants";

/**
 * 人物一覧の共通の並び順（学年 → 名前）。
 * 学年は GRADE_OPTIONS の順（B1…D3）、未設定は末尾。名前は日本語の読み順。
 */
export function compareByGradeThenName(
  a: { grade?: string | null; display_name?: string | null },
  b: { grade?: string | null; display_name?: string | null },
): number {
  const index = (grade: string | null | undefined) => {
    const found = GRADE_OPTIONS.findIndex((option) => option.value === grade);
    return found < 0 ? GRADE_OPTIONS.length : found;
  };
  return (
    index(a.grade) - index(b.grade) ||
    (a.display_name || "").localeCompare(b.display_name || "", "ja")
  );
}

export function sortByGradeThenName<
  T extends { grade?: string | null; display_name?: string | null },
>(list: T[]): T[] {
  return [...list].sort(compareByGradeThenName);
}
