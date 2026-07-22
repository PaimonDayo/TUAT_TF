import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushRecordToSheet, type DbRecord } from "@/lib/sheet-sync";
import { recordFieldsFromJson } from "@/lib/profile-normalize";

/**
 * write-through: 記録のメインがスプレッドシートの部員が、アプリで保存した1件を
 * その場でスプシへ書き込む（タスク16）。本人のみ実行可能。
 * DB保存自体はクライアント側（RecordForm）が先に行い、この呼び出しはその後続。
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { recordId?: string };
  const recordId = body.recordId;
  if (!recordId) {
    return NextResponse.json({ error: "recordIdを指定してください" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("id, sheet_name, record_fields")
    .eq("id", user.id)
    .maybeSingle();
  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }
  if (!profile?.sheet_name) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const { data: rec, error: rErr } = await admin
    .from("practice_records")
    .select(
      "id, user_id, recorded_date, dist_low, dist_mid, dist_high, dist_speed, strides, strength_text, result_text, memo, menu_text, focus_text, custom, updated_at, synced_at",
    )
    .eq("id", recordId)
    .maybeSingle();
  if (rErr) {
    return NextResponse.json({ error: rErr.message }, { status: 500 });
  }
  if (!rec || rec.user_id !== user.id) {
    return NextResponse.json({ error: "記録が見つかりません" }, { status: 404 });
  }

  try {
    const result = await pushRecordToSheet(
      profile.sheet_name,
      recordFieldsFromJson(profile.record_fields),
      rec as DbRecord,
    );
    // 成功: pending_sheet_pushをfalseに戻す（毎時同期の再送対象から外す）
    await admin
      .from("practice_records")
      .update({ synced_at: new Date().toISOString(), pending_sheet_push: false })
      .eq("id", recordId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "スプレッドシートへの反映に失敗しました";
    // 失敗: pending_sheet_pushをtrueにし、次回の毎時同期(runSheetSync)が明示的に再送する
    // （synced_atとの大小比較には頼らない。無関係な時刻ズレを再送対象と誤検知しないため）。
    await admin.from("practice_records").update({ pending_sheet_push: true }).eq("id", recordId);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
