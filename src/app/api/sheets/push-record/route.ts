import { sheetForRecord } from "@/lib/sheet-sync/period-routing";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pcAppWriteProtectionResponse, pcBackupProtectionResponse } from "@/lib/pc-backup-status";
import { pushRecordToSheet, processPendingClears, type DbRecord, type PushRecordResult } from "@/lib/sheet-sync";
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
  const protectedResponse = await pcAppWriteProtectionResponse();
  if (protectedResponse) return protectedResponse;

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
      "id, user_id, recorded_date, dist_low, dist_mid, dist_high, dist_speed, dist_actual, strides, strength_text, result_text, memo, menu_text, focus_text, custom, updated_at, synced_at, record_fields_snapshot",
    )
    .eq("id", recordId)
    .maybeSingle();
  if (rErr) {
    return NextResponse.json({ error: rErr.message }, { status: 500 });
  }
  if (!rec || rec.user_id !== user.id) {
    return NextResponse.json({ error: "記録が見つかりません" }, { status: 404 });
  }

  // pending is set by the record-save trigger before this request and also protects
  // unresolved app content from CSV overwrite. Partial/unknown responses prevent
  // caller resends, but do not exclude that existing flag from the later push planner.
  // Cutover requires a durable attempt receipt that the planner consumes.
  let sent: PushRecordResult | undefined;
  try {
    const target = await sheetForRecord(admin, user.id, rec.recorded_date);
    if (!target) return NextResponse.json({ ok: true, skipped: true });
    const result = await pushRecordToSheet(
      target.sheetName,
      rec.record_fields_snapshot ? recordFieldsFromJson(rec.record_fields_snapshot) : target.fields,
      rec as DbRecord,
      target.spreadsheetId,
    );
    sent = result;
    // 成功: pending_sheet_pushをfalseに戻す（毎日0時の再送対象から外す）。
    // 送信中に同じ記録が別の保存で変わっていたら（updated_at が違う）送信済みにしない。新しい内容は次回送る。
    const marker = await admin
      .from("practice_records")
      .update({ synced_at: new Date().toISOString(), pending_sheet_push: false })
      .eq("id", recordId)
      .eq("updated_at", rec.updated_at)
      .select("id");
    if (marker.error || marker.data?.length !== 1) throw marker.error ?? new Error("Sheet sent marker not confirmed");
    // 日付を変えた保存なら、元の日の欄を空にする予定が入っている。ついでに処理する（失敗しても毎日0時に再試行）。
    await processPendingClears(admin, {
      id: profile.id,
      sheet_name: profile.sheet_name,
      record_fields: recordFieldsFromJson(profile.record_fields),
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const protection = pcBackupProtectionResponse(err) ?? await pcAppWriteProtectionResponse();
    if (sent) return NextResponse.json({ ok: false, code: protection ? "PC_BACKUP_UNAVAILABLE" : "SHEET_SENT_MARKER_UNCONFIRMED",
      error: "スプレッドシートへの送信は完了しましたが、送信済み状態を確認できませんでした。再送せず、状態を確認してください。",
      outcome: "partial", externallySent: true, markerConfirmed: false, retryable: false, result: sent },
    { status: protection ? 503 : 502, headers: { "cache-control": "private, no-store" } });
    if (typeof err === "object" && err !== null && "code" in err && err.code === "SHEET_WRITE_RESULT_UNKNOWN") {
      return NextResponse.json({ ok: false, error: "スプレッドシートへの送信結果を確認できませんでした。再送せず、送信先を確認してください。",
        code: protection ? "PC_BACKUP_UNAVAILABLE" : "SHEET_WRITE_RESULT_UNKNOWN", outcome: "unknown", resultUnknown: true,
        externallySent: "unknown", retryable: false }, { status: protection ? 503 : 502, headers: { "cache-control": "private, no-store" } });
    }
    if (protection) return protection;
    const message = err instanceof Error ? err.message : "スプレッドシートに書き込めませんでした";
    // 失敗: pending_sheet_pushをtrueにし、次回の毎日0時連携(runSheetSync)が明示的に再送する
    // （synced_atとの大小比較には頼らない。無関係な時刻ズレを再送対象と誤検知しないため）。
    await admin.from("practice_records").update({ pending_sheet_push: true }).eq("id", recordId);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
