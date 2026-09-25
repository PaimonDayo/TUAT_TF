import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingClears } from "@/lib/sheet-sync";
import { recordFieldsFromJson } from "@/lib/profile-normalize";

/**
 * アプリで練習記録を消した直後に呼ぶ。本人の「スプシの欄を空にする予定」を処理する。
 * 予定はDBのトリガーが削除と同時に作るので、ここが失敗しても毎日0時の同期が空にする。
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
    const result = await processPendingClears(admin, {
      id: profile.id,
      sheet_name: profile.sheet_name,
      record_fields: recordFieldsFromJson(profile.record_fields),
    });
    return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed === 0 ? 200 : 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "スプレッドシートを更新できませんでした";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
