// アプリで消した練習記録について、スプシの同じ日の欄を空にする（2026-09-26 オーナー確定: 「アプリで消したらスプシも消す」）。
// 日付の行そのものは消さない（シートには全日付の行が並んでおり、行を消すと表が崩れる）。

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawMember } from "@/lib/sheet-public-csv";
import type { RecordFieldDef } from "@/types";
import { appToCellsFull, resolveFieldMap, sheetToAppValues, valuesEmpty } from "./field-map";
import type { DbRecord, FieldMap } from "./field-map";
import { gasPost, fetchMemberRaw } from "./gas-client";

export type PendingClear = { user_id: string; recorded_date: string };

/** その日の欄をすべて空にするために送る cells（連携している項目を全部 "" にする） */
export function clearCellsFor(map: FieldMap, date: string): Record<string, string | number> {
  const empty: DbRecord = {
    id: "",
    user_id: "",
    recorded_date: date,
    dist_low: 0,
    dist_mid: 0,
    dist_high: 0,
    dist_speed: 0,
    dist_actual: 0,
    strides: 0,
    strength_text: null,
    result_text: null,
    memo: null,
    menu_text: null,
    focus_text: null,
    custom: null,
    updated_at: null,
    synced_at: null,
  };
  return appToCellsFull(map, empty);
}

/**
 * スプシのその日の行に、連携している項目の中身が残っているか。
 * 行が無い日・もう空の日には書き込まない（GASは行が無いと新しく作ってしまうため）。
 */
export function sheetRowHasContent(map: FieldMap, member: RawMember, date: string): boolean {
  return member.records.some((record) => {
    if (record.date !== date) return false;
    const { builtin, custom } = sheetToAppValues(map, record);
    return !valuesEmpty(builtin, custom);
  });
}

/**
 * 1人分の「空にする予定」を処理する（保存・削除の直後に呼ぶ）。
 * - その日にアプリの記録がある（作り直した）なら予定だけ消す。記録側の書き込みがその日を上書きする。
 * - スプシに中身が残っていれば空にしてから予定を消す。書き込めなければ予定を残し、毎日0時の同期で再試行する。
 */
export async function processPendingClears(
  admin: SupabaseClient,
  profile: { id: string; sheet_name: string; record_fields: RecordFieldDef[] },
): Promise<{ cleared: number; failed: number }> {
  const { data: queued, error } = await admin
    .from("sheet_pending_clears")
    .select("user_id, recorded_date")
    .eq("user_id", profile.id)
    .order("recorded_date", { ascending: true })
    .limit(20);
  if (error) throw error;
  const rows = (queued ?? []) as PendingClear[];
  if (rows.length === 0) return { cleared: 0, failed: 0 };

  const { data: existing, error: existingError } = await admin
    .from("practice_records")
    .select("recorded_date")
    .eq("user_id", profile.id)
    .in("recorded_date", rows.map((row) => row.recorded_date));
  if (existingError) throw existingError;
  const recreated = new Set((existing ?? []).map((row) => row.recorded_date as string));

  const member = await fetchMemberRaw(profile.sheet_name);
  const map = resolveFieldMap(member, profile.record_fields);
  let cleared = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (!recreated.has(row.recorded_date) && sheetRowHasContent(map, member, row.recorded_date)) {
        await gasPost({ action: "writeCells", memberName: profile.sheet_name, date: row.recorded_date, cells: clearCellsFor(map, row.recorded_date) });
        cleared++;
      }
      const { error: deleteError } = await admin
        .from("sheet_pending_clears")
        .delete()
        .eq("user_id", row.user_id)
        .eq("recorded_date", row.recorded_date);
      if (deleteError) throw deleteError;
    } catch {
      failed++;
    }
  }
  return { cleared, failed };
}
