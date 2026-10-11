import { OCTOBER_START, legacySyncOpen } from "@/lib/sheet-period";
import { sheetForRecord } from "./period-routing";
// アプリで消した練習記録について、スプシの同じ日の欄を空にする（2026-09-26 オーナー確定: 「アプリで消したらスプシも消す」）。
// 日付の行そのものは消さない（シートには全日付の行が並んでおり、行を消すと表が崩れる）。

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawMember } from "@/lib/sheet-public-csv";
import type { RecordFieldDef } from "@/types";
import { appToCellsFull, sheetToAppValues, valuesEmpty } from "./field-map";
import type { DbRecord, FieldMap } from "./field-map";
import { clearIfExistingWithReceipt, listActivePushReceipts, resolvePendingClear, writeCellsTargetSlot } from "./push-receipt";

export type PendingClear = { user_id: string; recorded_date: string; created_at: string };

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
 * CSV表示用の比較。公開CSVの空欄や行なしは実シートの消去完了の証明には使わない。
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
 * - 確定した書き込みだけ予定を消す。結果不明・部分成功は receipt を保持し再送しない。
 */
export async function processPendingClears(
  admin: SupabaseClient,
  profile: { id: string; sheet_name: string; record_fields: RecordFieldDef[] },
): Promise<{ cleared: number; failed: number }> {
  let query = admin
    .from("sheet_pending_clears")
    .select("user_id, recorded_date, created_at")
    .eq("user_id", profile.id)
    .order("recorded_date", { ascending: true })
    .limit(20);
  if (!legacySyncOpen()) query = query.gte("recorded_date", OCTOBER_START);
  const { data: queued, error } = await query;
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
  const active = await listActivePushReceipts(admin);

  let cleared = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const target = await sheetForRecord(admin, profile.id, row.recorded_date);
      if (!target) continue; // Closed periods stay untouched.
      if (recreated.has(row.recorded_date)) {
        await resolvePendingClear(admin, { profileId: row.user_id, date: row.recorded_date, expectedVersion: row.created_at,
          expectedProfile: target.expectedProfile, targetSlot: writeCellsTargetSlot(target.sheetName, row.recorded_date, target.spreadsheetId) });
        continue;
      }
      const written = await clearIfExistingWithReceipt(admin, { kind: "clear", recordId: null, profileId: row.user_id,
        date: row.recorded_date, expectedVersion: row.created_at, expectedProfile: target.expectedProfile }, target, active);
      if (written.receipt.outcome !== "completed" || written.receipt.marker_status !== "applied") throw new Error("削除予定の完了を確認できませんでした");
      // Count confirmed clear requests; an authoritative missing ACK creates no row.
      cleared++;
    } catch {
      failed++;
    }
  }
  return { cleared, failed };
}
