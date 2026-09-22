// 練習記録と自己ベストの取得。

import { createClient } from "@/lib/supabase/server";
import { jstToday } from "@/lib/date";
import { normalizePracticeRecord } from "@/lib/profile-normalize";
import { RECORD_NONEMPTY_OR } from "@/lib/record-content";
import { displayedDistance } from "@/lib/record-distance";
import type { PbRecord, PracticeRecord } from "@/types";
import { RECORD_LIST_SELECT, attachRecordFieldGroups, fetchTargetSocialState } from "./internal";

/** 週間カード用。本文・プロフィール・項目定義を取得せず、同じ対象日の距離と件数を集計する。 */
export async function getUserTrainingSummary(userId: string, fromDate: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("practice_records")
    .select("dist_low,dist_mid,dist_high,dist_speed,dist_actual")
    .eq("user_id", userId)
    .gte("recorded_date", fromDate)
    .lte("recorded_date", jstToday())
    .or(RECORD_NONEMPTY_OR);
  if (error) throw error;
  const records = data ?? [];
  return {
    distance: records.reduce((sum, record) => sum + displayedDistance(record), 0),
    count: records.length,
  };
}

/** ユーザーの期間内の練習記録（マイページに使用） */
export async function getUserRecords(userId: string, fromDate?: string) {
  const supabase = await createClient();
  // fromDate省略時も無期限取得はしない（TrainingChartの最大表示期間は12ヶ月分）。
  const defaultFromDate = new Date();
  defaultFromDate.setDate(defaultFromDate.getDate() - 400);
  const q = supabase
    .from("practice_records")
    .select(RECORD_LIST_SELECT)
    .eq("user_id", userId)
    .lte("recorded_date", jstToday()) // 未来日は除外
    .or(RECORD_NONEMPTY_OR) // 空の記録は除外
    .gte("recorded_date", fromDate ?? defaultFromDate.toISOString().slice(0, 10))
    .order("recorded_date", { ascending: false });
  const { data } = await q;
  return attachRecordFieldGroups(supabase, (data ?? []).map((row) => normalizePracticeRecord({ ...row, record_fields_snapshot: null })));
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
