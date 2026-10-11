// アプリの記録をシートへ書き込む（write-through 保存）。

import type { RecordFieldDef } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { customRecordFields } from "@/lib/record-fields";
import { BUILTINS, resolveFieldMap, appBuiltin, appToCellsFull, BUILTIN_LABELS } from "./field-map";
import type { DbRecord, FieldMap } from "./field-map";
import { fetchMemberRaw } from "./gas-client";
import type { RoutedSheet } from "./period-routing";
import { writeCellsWithReceipt, type PushReceiptResult } from "./push-receipt";

export type PushRecordResult = {
  /** シートにその項目の列が無い等で書き込めなかった項目（アプリ側の表示ラベル）。黙って落とさず可視化するため */
  unmapped: string[];
  action: "created" | "updated";
  /** Null means no provider write was possible; pending stays protected. */
  receipt: PushReceiptResult | null;
};

export function unmappedRecordFields(map: FieldMap, recordFields: RecordFieldDef[], rec: DbRecord): string[] {
  const unmapped: string[] = [];
  for (const b of BUILTINS) {
    if (map.builtin.has(b.key) || recordFields.find((field) => field.key === b.key)?.hidden) continue;
    const v = appBuiltin(rec, b.key);
    const nonEmpty = b.numeric ? Number(v) > 0 : (v ?? "").toString().trim() !== "";
    if (nonEmpty) unmapped.push(recordFields.find((field) => field.key === b.key)?.label.trim() || BUILTIN_LABELS[b.key]);
  }
  for (const f of customRecordFields(recordFields)) {
    if (map.custom.has(f.key)) continue;
    const v = rec.custom?.[f.key];
    if ((v ?? "").toString().trim() !== "") unmapped.push(f.label);
  }
  return unmapped;
}

/**
 * write-through: アプリで保存した1件をその場でスプシへ書き込む（タスク16）。
 * アプリで保存したマップ済み項目を反映する。空欄も送って既存セルをクリアする。
 * シートに列が無い項目は書き込まず unmapped に集めて呼び出し側へ返す（黙って落とさない）。
 */
export async function pushRecordToSheet(
  admin: SupabaseClient,
  target: RoutedSheet,
  recordFields: RecordFieldDef[],
  rec: DbRecord,
): Promise<PushRecordResult> {
  const member = await fetchMemberRaw(target.sheetName, { spreadsheetId: target.spreadsheetId });
  const map = resolveFieldMap(member, recordFields);
  const cells = appToCellsFull(map, rec);

  // シートに列自体が無く、送信すらされなかった項目（可視化用）
  const unmapped = unmappedRecordFields(map, recordFields, rec);

  if (Object.keys(cells).length === 0) {
    return { unmapped, action: "updated", receipt: null };
  }
  if (!rec.updated_at) throw new Error("記録の更新時刻を確認できませんでした。送信を保留しました");
  return writeCellsWithReceipt(admin, { kind: "record", recordId: rec.id, profileId: rec.user_id,
    date: rec.recorded_date, expectedVersion: rec.updated_at, expectedProfile: target.expectedProfile },
  { ...target, fields: recordFields, columns: member.columns ?? member.header.map((label, index) => ({ index, label })) }, cells, unmapped);
}
