// システムロール向け: ある月の、全員の大会・記録会の結果。

import { createClient } from "@/lib/supabase/server";
import type { Block, PbRecord } from "@/types";

export type MonthlyResult = PbRecord & {
  author: { display_name: string; grade: string | null; blocks: Block[] } | null;
  competition: { name: string } | null;
};

/** month は "YYYY-MM"。大学の結果で、記録日が入っているものだけ（高校以前・日付なしは対象外）。 */
export async function getMonthlyResults(month: string) {
  const supabase = await createClient();
  const [year, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const next = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
  const { data, error } = await supabase
    .from("pb_records")
    .select("*, author:profiles!user_id(display_name, grade, blocks), competition:competitions!competition_id(name)")
    .eq("stage", "university")
    .gte("recorded_on", from)
    .lt("recorded_on", next)
    .order("recorded_on", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MonthlyResult[];
}
