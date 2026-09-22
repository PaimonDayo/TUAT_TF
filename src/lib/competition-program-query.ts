import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CompetitionProgramEntryRow } from "@/types";

/** SSRと部分更新で同じ列・並び順・本人のRLSを使う。 */
export async function readCompetitionProgramEntries(
  supabase: SupabaseClient<Database>, competitionId: string, signal?: AbortSignal,
): Promise<CompetitionProgramEntryRow[]> {
  let query = supabase.from("competition_program_entries")
    .select("id,competition_id,event_date,block,sort_order,time_label,round_key,event_label,status,tuat_entries,created_at")
    .eq("competition_id", competitionId)
    .order("event_date").order("block").order("sort_order");
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as CompetitionProgramEntryRow[];
}
