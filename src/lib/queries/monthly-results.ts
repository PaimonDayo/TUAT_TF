// システムロール向け: 全員の大会・記録会の結果（月別・年別・新着）。

import { createClient } from "@/lib/supabase/server";
import type { Block, PbRecord } from "@/types";

export type MonthlyResult = PbRecord & {
  author: { display_name: string; grade: string | null; blocks: Block[] } | null;
  competition: { name: string } | null;
};

const SELECT = "*, author:profiles!user_id(display_name, grade, blocks), competition:competitions!competition_id(name)";

/** [from, to) の記録日の結果。大学の結果で、記録日が入っているものだけ（高校以前・日付なしは対象外）。 */
async function getResultsBetween(from: string, to: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pb_records")
    .select(SELECT)
    .eq("stage", "university")
    .gte("recorded_on", from)
    .lt("recorded_on", to)
    .order("recorded_on", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MonthlyResult[];
}

/** month は "YYYY-MM" */
export async function getMonthlyResults(month: string) {
  const [year, m] = month.split("-").map(Number);
  const next = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
  return getResultsBetween(`${month}-01`, next);
}

/** year は "YYYY" */
export async function getYearlyResults(year: string) {
  return getResultsBetween(`${year}-01-01`, `${Number(year) + 1}-01-01`);
}

/** 新しく登録された結果（登録した日時の新しい順）。高校以前も含む。 */
export async function getLatestResults(limit = 50) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pb_records")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as MonthlyResult[];
}
