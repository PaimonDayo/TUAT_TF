import { sheetForRecord } from "@/lib/sheet-sync/period-routing";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pcAppWriteProtectionResponse, pcBackupProtectionResponse } from "@/lib/pc-backup-status";
import { pushRecordToSheet, processPendingClears, type DbRecord } from "@/lib/sheet-sync";
import { recordFieldsFromJson } from "@/lib/profile-normalize";
import { SheetPushReceiptError } from "@/lib/sheet-sync/push-receipt";

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

  // The save trigger retains pending content. Both this request and the planner
  // now reserve a durable receipt before dispatch; unresolved attempts never replay.
  try {
    const target = await sheetForRecord(admin, user.id, rec.recorded_date);
    if (!target) return NextResponse.json({ ok: true, skipped: true });
    const result = await pushRecordToSheet(
      admin,
      target,
      rec.record_fields_snapshot ? recordFieldsFromJson(rec.record_fields_snapshot) : target.fields,
      rec as DbRecord,
    );
    if (result.receipt?.outcome !== "completed" || result.receipt.marker_status !== "applied") {
      return NextResponse.json({ ok: false, code: "SHEET_PUSH_PARTIAL", outcome: "partial", retryable: false,
        externallySent: result.receipt !== null, markerConfirmed: false, result,
        error: result.receipt?.marker_status === "superseded" ? "送信中に記録またはシート設定が変わりました。最新の内容と送信先を確認してください。"
          : "一部の項目を書き込めませんでした。再送せず、スプレッドシートの入力項目と送信結果を確認してください。" },
      { status: 502, headers: { "cache-control": "private, no-store" } });
    }
    // The finish RPC atomically records delivery and applies the version-bound
    // pending marker. Clear requests use the same receipt or guarded no-op RPC.
    await processPendingClears(admin, {
      id: profile.id,
      sheet_name: profile.sheet_name,
      record_fields: recordFieldsFromJson(profile.record_fields),
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const protection = pcBackupProtectionResponse(err) ?? pcBackupProtectionResponse(err instanceof Error ? err.cause : undefined) ?? await pcAppWriteProtectionResponse();
    if (err instanceof SheetPushReceiptError) {
      return NextResponse.json({ ok: false, code: protection ? "PC_BACKUP_UNAVAILABLE" : err.code, error: err.message,
        outcome: err.externallySent === true ? "partial" : err.resultUnknown ? "unknown" : "held",
        externallySent: err.externallySent, markerConfirmed: false, resultUnknown: err.resultUnknown, retryable: false,
        ...(err.attemptId ? { attemptId: err.attemptId } : {}) },
      { status: protection ? 503 : ["SHEET_PUSH_BLOCKED", "SHEET_PUSH_STALE"].includes(err.code) ? 409 : 502,
        headers: { "cache-control": "private, no-store" } });
    }
    if (typeof err === "object" && err !== null && "code" in err && err.code === "SHEET_WRITE_RESULT_UNKNOWN") {
      return NextResponse.json({ ok: false, error: "スプレッドシートへの送信結果を確認できませんでした。再送せず、送信先を確認してください。",
        code: protection ? "PC_BACKUP_UNAVAILABLE" : "SHEET_WRITE_RESULT_UNKNOWN", outcome: "unknown", resultUnknown: true,
        externallySent: "unknown", retryable: false }, { status: protection ? 503 : 502, headers: { "cache-control": "private, no-store" } });
    }
    if (protection) return protection;
    const message = err instanceof Error ? err.message : "スプレッドシートに書き込めませんでした";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
