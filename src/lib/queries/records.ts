// 練習記録と自己ベストの取得。

import { createClient } from "@/lib/supabase/server";
import { jstToday } from "@/lib/date";
import { normalizePracticeRecord } from "@/lib/profile-normalize";
import { RECORD_NONEMPTY_OR } from "@/lib/record-content";
import type { PbRecord, PracticeRecord } from "@/types";
import { fetchTargetSocialState } from "./internal";

/** ユーザーの期間内の練習記録（マイページ・週間集計に使用） */
export async function getUserRecords(userId: string, fromDate?: string) {
  const supabase = await createClient();
  // fromDate省略時も無期限取得はしない（TrainingChartの最大表示期間は12ヶ月分）。
  const defaultFromDate = new Date();
  defaultFromDate.setDate(defaultFromDate.getDate() - 400);
  const q = supabase
    .from("practice_records")
    .select("*")
    .eq("user_id", userId)
    .lte("recorded_date", jstToday()) // 未来日は除外
    .or(RECORD_NONEMPTY_OR) // 空の記録は除外
    .gte("recorded_date", fromDate ?? defaultFromDate.toISOString().slice(0, 10))
    .order("recorded_date", { ascending: false });
  const { data } = await q;
  return (data ?? []).map(normalizePracticeRecord);
}

/** 他部員ページ用。記録に閲覧者本人のいいね状態とコメント数を付与する。 */
export async function getUserRecordsWithSocialState(
  userId: string,
  currentUserId: string,
): Promise<PracticeRecord[]> {
  const records = (await getUserRecords(userId)) as PracticeRecord[];
  const ids = records.map((record) => record.id);
  const supabase = await createClient();
  void currentUserId;
  const { liked, comments } = await fetchTargetSocialState(supabase, "record", ids);
  return records.map((record) => ({
    ...record,
    liked_by_me: liked.has(record.id),
    comments_count: comments.get(record.id) ?? 0,
  }));
}
/** あるユーザーの PB 一覧 */
export async function getPbRecords(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pb_records")
    .select("*")
    .eq("user_id", userId)
    .order("recorded_on", { ascending: false, nullsFirst: false });
  return (data ?? []) as PbRecord[];
}
