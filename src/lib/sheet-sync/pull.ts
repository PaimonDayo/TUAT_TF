// シートの内容からアプリへの取り込み差分を組み立てる（純粋な計算）。

import { type RawMember } from "@/lib/sheet-public-csv";
import { sheetRecordCreatedAt } from "./dates";
import { appBuiltin, sheetToAppValues, valuesEmpty } from "./field-map";
import type { BuiltinKey, FieldMap, DbRecord } from "./field-map";

export type MemberPullComputation = {
  inserts: Record<string, unknown>[];
  updates: { id: string; patch: Record<string, unknown> }[];
  /** 同日に複数記録がある曖昧な日付（呼び出し側でシート名等を付与して報告する） */
  conflicts: string[];
};

/**
 * 1部員分の「シート→アプリ」pullを計算する（runSheetSyncのpull-onlyブランチと
 * 定期連携のpull処理を計算する純粋関数。副作用なし（DB書き込みは呼び出し側が行う）。
 */
export type ExistingSheetRecordPolicy = "merge_nonempty" | "replace_mapped" | "preserve";
export function sheetRecordsWithoutPendingPushes(
  records: RawMember["records"],
  pendingPushDates: Set<string>,
): RawMember["records"] {
  return records.filter((record) => !pendingPushDates.has(record.date));
}


export function computeMemberPull(
  profileId: string,
  map: FieldMap,
  sheetRecords: RawMember["records"],
  appByDate: Map<string, DbRecord[]>,
  inRangeForProfile: (date: string) => boolean,
  nowIso: string,
  existingRecordPolicy: ExistingSheetRecordPolicy = "merge_nonempty",
): MemberPullComputation {
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const conflicts: string[] = [];

  for (const sr of sheetRecords) {
    if (!sr.date || !inRangeForProfile(sr.date)) continue; // カットオフ前・未来日は無視

    const appList = appByDate.get(sr.date) ?? [];
    if (appList.length > 1) {
      conflicts.push(sr.date); // 複数/日は触らない
      continue;
    }
    const app = appList[0];
    // App-main members keep existing DB dates authoritative. CSV only fills missing dates.
    if (app && existingRecordPolicy === "preserve") continue;

    const { builtin, custom } = sheetToAppValues(map, sr);

    if (!app) {
      if (valuesEmpty(builtin, custom)) continue; // 空の行は新規に取り込まない
      inserts.push({
        user_id: profileId,
        recorded_date: sr.date,
        // 新規/内容変更の取り込みを上部へ。同じバッチ内は練習日の新しい順。
        created_at: sheetRecordCreatedAt(sr.date, new Date(nowIso)),
        synced_at: nowIso,
        updated_at: nowIso,
        from_sheet: true,
        custom,
        ...builtin,
      });
      continue;
    }

    // 段階リリース中はシステム管理ロールだけ、確認済み列の空欄も意図した削除として反映する。
    // 一般部員は従来どおり空でない値だけを取り込み、既存運用を変えない。
    const replaceMapped = existingRecordPolicy === "replace_mapped";
    const patch: Record<string, unknown> = {};
    for (const [key, mapping] of map.builtin) {
      const v = builtin[key];
      const shouldApply = replaceMapped || (mapping.numeric ? Number(v) > 0 : (v ?? "").toString().trim() !== "");
      if (shouldApply && v !== appBuiltin(app, key as BuiltinKey)) patch[key] = v;
    }
    const customPatch: Record<string, string | number | null> = { ...(app.custom ?? {}) };
    let customChanged = false;
    for (const [key, mapping] of map.custom) {
      const v = custom[key];
      const shouldApply = replaceMapped || (mapping.type === "number" ? Number(v) > 0 : (v ?? "").toString().trim() !== "");
      if (shouldApply && v !== (app.custom?.[key] ?? null)) {
        customPatch[key] = v;
        customChanged = true;
      }
    }
    if (Object.keys(patch).length > 0 || customChanged) {
      if (customChanged) patch.custom = customPatch;
      // A sheet can correct an app-authored record without publishing it again.
      // Only records originally imported from a sheet move to this batch's time.
      if (app.from_sheet === true) patch.created_at = sheetRecordCreatedAt(sr.date, new Date(nowIso));
      patch.synced_at = nowIso;
      updates.push({ id: app.id, patch });
    }
  }

  return { inserts, updates, conflicts };
}
