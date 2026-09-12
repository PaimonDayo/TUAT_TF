// 記録の入力元を切り替えるときの、一度だけの突き合わせ。

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordFieldDef } from "@/types";
import { type RawMember } from "@/lib/sheet-public-csv";
import { SHEET_HISTORY_START, todayJST, sheetRecordCreatedAt } from "./dates";
import { resolveFieldMap, appBuiltin, sheetToAppValues, valuesEmpty, appToCellsNonEmpty } from "./field-map";
import type { BuiltinKey, DbRecord } from "./field-map";
import { gasPost, fetchMemberRaw } from "./gas-client";

export type ReconcileResult = {
  direction: "to_sheet" | "to_app";
  pushed: number;
  pulled: number;
  skipped: string[]; // "日付" 単位でスキップした理由
  dryRun: boolean;
};

/**
 * 入力元(record_source)を切り替える直前に、その部員だけを対象に一度だけ
 * 両側を揃える（オーナー確定 2026-07-04・2026-07-03インシデントの再発防止）。
 *   to_sheet（app→sheet切替）: アプリの中身のある項目をシートへ書き出す（アプリが正＝勝つ）。
 *   to_app（sheet→app切替）: シートの中身のある項目をアプリへ取り込む（シートが正＝勝つ）。
 * いずれも非破壊（空で相手を消さない）。同日複数記録など曖昧な日はスキップして報告する。
 */
export async function reconcileOnSwitch(
  admin: SupabaseClient,
  profileId: string,
  direction: "to_sheet" | "to_app",
  options: { dryRun?: boolean } = {},
): Promise<ReconcileResult> {
  const dryRun = !!options.dryRun;
  const result: ReconcileResult = { direction, pushed: 0, pulled: 0, skipped: [], dryRun };
  const today = todayJST();

  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("id, sheet_name, record_fields")
    .eq("id", profileId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!profile?.sheet_name) return result; // 連携していなければ何もしない

  let member: RawMember;
  try {
    member = await fetchMemberRaw(profile.sheet_name);
  } catch {
    result.skipped.push(`シート「${profile.sheet_name}」が見つかりません`);
    return result;
  }
  const map = resolveFieldMap(member, (profile.record_fields as RecordFieldDef[]) ?? []);

  const { data: existing, error: rErr } = await admin
    .from("practice_records")
    .select(
      "id, user_id, recorded_date, dist_low, dist_mid, dist_high, dist_speed, dist_actual, strides, strength_text, result_text, memo, menu_text, focus_text, custom, updated_at, synced_at, pending_sheet_push",
    )
    .eq("user_id", profileId)
    .gte("recorded_date", SHEET_HISTORY_START);
  if (rErr) throw rErr;

  const byDate = new Map<string, DbRecord[]>();
  for (const r of (existing ?? []) as DbRecord[]) {
    const arr = byDate.get(r.recorded_date) ?? [];
    arr.push(r);
    byDate.set(r.recorded_date, arr);
  }

  const nowIso = new Date().toISOString();

  if (direction === "to_sheet") {
    // アプリが正: 中身のある項目だけシートへ書き出す
    for (const [date, list] of byDate) {
      if (date > today) continue;
      if (list.length > 1) {
        result.skipped.push(`${date}（同日に複数記録）`);
        continue;
      }
      const cells = appToCellsNonEmpty(map, list[0]);
      if (Object.keys(cells).length === 0) continue;
      result.pushed++;
      if (!dryRun) {
        await gasPost({ action: "writeCells", memberName: profile.sheet_name, date, cells });
        await admin
          .from("practice_records")
          .update({ synced_at: nowIso })
          .eq("id", list[0].id);
      }
    }
  } else {
    // シートが正: 中身のある項目だけアプリへ取り込む
    for (const sr of member.records) {
      if (!sr.date || sr.date < SHEET_HISTORY_START || sr.date > today) continue;
      const appList = byDate.get(sr.date) ?? [];
      if (appList.length > 1) {
        result.skipped.push(`${sr.date}（同日に複数記録）`);
        continue;
      }
      const { builtin, custom } = sheetToAppValues(map, sr);
      if (valuesEmpty(builtin, custom)) continue;
      const app = appList[0];

      if (!app) {
        result.pulled++;
        if (!dryRun) {
          const { error } = await admin.from("practice_records").insert({
            user_id: profileId,
            recorded_date: sr.date,
            created_at: sheetRecordCreatedAt(sr.date),
            synced_at: nowIso,
            updated_at: nowIso,
            from_sheet: true,
            custom,
            ...builtin,
          });
          if (error) throw error;
        }
        continue;
      }

      const patch: Record<string, unknown> = {};
      for (const [key, m] of map.builtin) {
        const v = builtin[key];
        const nonEmpty = m.numeric ? Number(v) > 0 : (v ?? "").toString().trim() !== "";
        if (nonEmpty && v !== appBuiltin(app, key as BuiltinKey)) patch[key] = v;
      }
      const customPatch: Record<string, string | number | null> = { ...(app.custom ?? {}) };
      let customChanged = false;
      for (const [key] of map.custom) {
        const v = custom[key];
        if ((v ?? "").toString().trim() !== "" && v !== (app.custom?.[key] ?? null)) {
          customPatch[key] = v;
          customChanged = true;
        }
      }
      if (Object.keys(patch).length > 0 || customChanged) {
        result.pulled++;
        if (!dryRun) {
          if (customChanged) patch.custom = customPatch;
          patch.synced_at = nowIso;
          const { error } = await admin.from("practice_records").update(patch).eq("id", app.id);
          if (error) throw error;
        }
      }
    }
  }

  return result;
}
