import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordFieldDef } from "@/types";
import { OCTOBER_SHEET_ID, OCTOBER_START, legacySyncOpen, parseSheetTransition } from "@/lib/sheet-period";
import { recordFieldsFromJson } from "@/lib/profile-normalize";

export async function systemSheetProfileIds(admin: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await admin.from("profile_roles")
    .select("profile_id, roles!inner(can_manage_system)").eq("roles.can_manage_system", true);
  if (error) throw new Error("シート切替対象の権限を確認できませんでした");
  return new Set((data ?? []).map(row => String(row.profile_id)));
}

export type RoutedSheet = { sheetName: string; fields: RecordFieldDef[]; spreadsheetId?: string };
/** A null target means the old period is closed or the profile is unlinked. */
export async function sheetForRecord(admin: SupabaseClient, profileId: string, date: string): Promise<RoutedSheet | null> {
  const [{ data: profile, error }, systems] = await Promise.all([
    admin.from("profiles").select("sheet_name,record_fields,sheet_transition").eq("id", profileId).single(),
    systemSheetProfileIds(admin),
  ]);
  if (error) throw new Error("シート設定を取得できませんでした");
  const transition = parseSheetTransition(profile.sheet_transition);
  if (transition?.mode === "off") return null;
  if (!systems.has(profileId) && !transition) {
    return profile.sheet_name ? { sheetName: profile.sheet_name, fields: recordFieldsFromJson(profile.record_fields) } : null;
  }
  if (date < OCTOBER_START) {
    if (!legacySyncOpen()) return null;
    const legacy = transition?.legacy;
    const name = legacy ? legacy.sheet_name : profile.sheet_name;
    return name ? { sheetName: name, fields: legacy ? legacy.record_fields : recordFieldsFromJson(profile.record_fields) } : null;
  }
  if (!systems.has(profileId)) return null;
  if (!transition) throw new Error("10月以降のシート・入力項目を先に確認してください。記録はアプリに保存されています");
  return profile.sheet_name ? { sheetName: profile.sheet_name, fields: recordFieldsFromJson(profile.record_fields), spreadsheetId: OCTOBER_SHEET_ID } : null;
}
