// システムロール向け: ある1日の、全員の練習記録と未入力の部員。

import { createClient } from "@/lib/supabase/server";
import { displayedDistance } from "@/lib/record-distance";
import type { Block } from "@/types";

export type DailyRecordMember = { id: string; display_name: string; grade: string | null; blocks: Block[] };
export type DailyRecord = {
  id: string;
  author: DailyRecordMember;
  distance: number;
  menu_text: string | null;
  result_text: string | null;
  memo: string | null;
};

export async function getDailyRecords(date: string) {
  const supabase = await createClient();
  const [{ data: records, error: recordError }, { data: members, error: memberError }] = await Promise.all([
    supabase
      .from("practice_records")
      .select("id, user_id, dist_low, dist_mid, dist_high, dist_speed, dist_actual, menu_text, result_text, memo")
      .eq("recorded_date", date),
    supabase
      .from("profiles")
      .select("id, display_name, grade, blocks")
      .eq("status", "active"),
  ]);
  if (recordError) throw recordError;
  if (memberError) throw memberError;

  const memberById = new Map((members ?? []).map((m) => [m.id, m as DailyRecordMember]));
  const withRecord = new Set<string>();
  const rows: DailyRecord[] = [];
  for (const r of records ?? []) {
    const author = memberById.get(r.user_id);
    if (!author) continue; // 退部者などの記録は出さない
    withRecord.add(r.user_id);
    rows.push({
      id: r.id,
      author,
      distance: displayedDistance(r),
      menu_text: r.menu_text,
      result_text: r.result_text,
      memo: r.memo,
    });
  }
  // マネージャーだけの人は練習記録を付けないので、未入力には数えない。
  const missing = [...memberById.values()].filter(
    (m) => !withRecord.has(m.id) && (m.blocks ?? []).some((b) => b !== "manager"),
  );
  return { records: rows, missing };
}
