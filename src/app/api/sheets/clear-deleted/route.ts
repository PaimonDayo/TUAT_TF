import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingClears } from "@/lib/sheet-sync";
import { pcAppWriteProtectionResponse, pcBackupProtectionResponse } from "@/lib/pc-backup-status";
import { recordFieldsFromJson } from "@/lib/profile-normalize";

/**
 * アプリで練習記録を消した直後に呼ぶ。本人の「スプシの欄を空にする予定」を処理する。
 * 予定はDB削除と同時に作る。シート側の確定を確認し、結果不明・部分成功は保持して再送しない。
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, sheet_name, record_fields")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!profile?.sheet_name) return NextResponse.json({ ok: true, skipped: true });

  try {
    const protectedResponse = await pcAppWriteProtectionResponse();
    if (protectedResponse) return protectedResponse;
    const result = await processPendingClears(admin, {
      id: profile.id,
      sheet_name: profile.sheet_name,
      record_fields: recordFieldsFromJson(profile.record_fields),
    });
    if (result.failed) {
      const protection = await pcAppWriteProtectionResponse();
      return NextResponse.json({ ok: false, ...result, retryable: false,
        code: protection ? "PC_BACKUP_UNAVAILABLE" : "SHEET_CLEAR_UNCONFIRMED",
        error: "スプレッドシートの削除完了を確認できませんでした。再送せず、送信先を確認してください。" },
      { status: protection ? 503 : 502, headers: { "cache-control": "private, no-store" } });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const protection = pcBackupProtectionResponse(err) ?? await pcAppWriteProtectionResponse();
    if (protection) return protection;
    return NextResponse.json({ ok: false, code: "SHEET_CLEAR_UNCONFIRMED", retryable: false,
      error: "スプレッドシートの削除完了を確認できませんでした。再送せず、送信先を確認してください。" },
    { status: 502, headers: { "cache-control": "private, no-store" } });
  }
}
