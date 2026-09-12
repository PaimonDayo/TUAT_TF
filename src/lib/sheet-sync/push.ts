// アプリの記録をシートへ書き込む（write-through 保存）。

import type { RecordFieldDef } from "@/types";
import { customRecordFields } from "@/lib/record-fields";
import { BUILTINS, resolveFieldMap, appBuiltin, appToCellsFull, BUILTIN_LABELS } from "./field-map";
import type { DbRecord } from "./field-map";
import { gasPost, fetchMemberRaw } from "./gas-client";

export type PushRecordResult = {
  /** シートにその項目の列が無い等で書き込めなかった項目（アプリ側の表示ラベル）。黙って落とさず可視化するため */
  unmapped: string[];
  action: "created" | "updated";
};

/**
 * write-through: アプリで保存した1件をその場でスプシへ書き込む（タスク16）。
 * アプリで保存したマップ済み項目を反映する。空欄も送って既存セルをクリアする。
 * シートに列が無い項目は書き込まず unmapped に集めて呼び出し側へ返す（黙って落とさない）。
 */
export async function pushRecordToSheet(
  sheetName: string,
  recordFields: RecordFieldDef[],
  rec: DbRecord,
): Promise<PushRecordResult> {
  const member = await fetchMemberRaw(sheetName);
  const map = resolveFieldMap(member, recordFields);
  const cells = appToCellsFull(map, rec);

  // シートに列自体が無く、送信すらされなかった項目（可視化用）
  const unmapped: string[] = [];
  for (const b of BUILTINS) {
    // Actual distance is a first-class mapped value.
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

  if (Object.keys(cells).length === 0) {
    return { unmapped, action: "updated" };
  }

  const res = await gasPost<{
    success: boolean;
    action: "created" | "updated";
    unmapped?: string[];
  }>({
    action: "writeCells",
    memberName: sheetName,
    date: rec.recorded_date,
    cells,
  });

  // GAS側でも書けなかった見出しがあれば統合（マッピング取得後にシート列が変わった等のズレ対策）
  if (res.unmapped && res.unmapped.length > 0) unmapped.push(...res.unmapped);
  return { unmapped, action: res.action };
}
