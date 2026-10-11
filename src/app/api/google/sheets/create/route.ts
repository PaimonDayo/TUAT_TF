import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pcAppWriteProtectionResponse, pcBackupProtectionResponse } from "@/lib/pc-backup-status";
import {
  createScheduleSpreadsheet,
  decryptGoogleToken,
  refreshGoogleAccessToken,
  scheduleSpreadsheetFingerprint,
  SpreadsheetCreationError,
  type CreatedSpreadsheet,
} from "@/lib/google-drive";
import { beginGoogleSheetCreation, GoogleSheetCreationReceiptError, readGoogleSheetCreation, registerGoogleSheetResource,
  rememberGoogleSheetResource, rememberGoogleSheetSetup, validCreationSpec, type CreationReceipt } from "@/lib/google-sheet-creation";
import { BLOCKS } from "@/lib/constants";
import type {
  PracticeSchedule,
  ScheduleSheetBlock,
  ScheduleSheetKind,
  ScheduleSheetWeekdayDefault,
  VenueRow,
} from "@/types";

type RequestBody = {
  mode?: "repair";
  attemptId?: string;
  kind: ScheduleSheetKind;
  block: ScheduleSheetBlock;
  year?: number;
  month?: number;
  scheduleIds?: string[];
  weekdayDefaults?: ScheduleSheetWeekdayDefault[];
};

const privateHeaders = { "cache-control": "private, no-store" };
function failedRead(error: unknown) {
  return pcBackupProtectionResponse(error) ?? NextResponse.json({ error: "保存状態を確認できませんでした。作り直さず、時間をおいて確認してください" }, { status: 503, headers: privateHeaders });
}
async function authorizedUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return failedRead(error);
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const permission = await supabase.rpc("can_create_schedule");
  if (permission.error) return failedRead(permission.error);
  if (!permission.data) return NextResponse.json({ error: "予定作成権限がありません" }, { status: 403 });
  return { supabase, user };
}

export async function GET() {
  try {
    const authorization = await authorizedUser();
    if (authorization instanceof Response) return authorization;
    return NextResponse.json({ attempt: await readGoogleSheetCreation(authorization.supabase) }, { headers: privateHeaders });
  } catch (error) { return failedRead(error); }
}

function receiptResponse(receipt: CreationReceipt, repair = false) {
  const intact = receipt.state === "registered" && receipt.record_status === "present";
  if (intact && (receipt.setup_confirmed || repair)) return NextResponse.json({ id: receipt.sheet_id, url: receipt.resource!.url,
    spreadsheetId: receipt.resource!.spreadsheetId, attemptId: receipt.attempt_id, setupConfirmed: receipt.setup_confirmed,
    outcome: receipt.setup_confirmed ? "completed" : "partial", retryable: false,
    ...(receipt.setup_confirmed ? {} : { error: "シートの登録を確認しました。書式設定は未確認です。作り直さず、作成済みのシートを確認してください" }) }, { headers: privateHeaders });
  const message = receipt.record_status === "deleted" ? "登録済みのシート情報は削除されています。作り直さず、作成済みのシートを確認してください"
    : receipt.record_status === "changed" ? "登録済みのシート情報が変更されています。作り直さず、作成済みのシートを確認してください"
      : receipt.resource ? "作成済みのシートがあります。作り直さず、シートの登録状態を確認してください"
        : "作成結果を確認できませんでした。作り直さず、Google Driveで作成済みのシートを確認してください";
  return NextResponse.json({ error: message, code: "SHEET_CREATION_HELD", outcome: receipt.resource ? "partial" : "unknown",
    attempt: receipt,
    attemptId: receipt.attempt_id, phase: !receipt.resource ? "create" : !receipt.setup_confirmed ? "setup" : "record", setupConfirmed: receipt.setup_confirmed,
    recordStatus: receipt.record_status, resultUnknown: !receipt.resource, retryable: false, resource: receipt.resource }, { status: 502, headers: privateHeaders });
}

export async function POST(request: Request) {
  let body: RequestBody;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "発行条件が不正です" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "発行条件が不正です" }, { status: 400 });
  if (body.mode === "repair") {
    const authorization = await authorizedUser();
    if (authorization instanceof Response) return authorization;
    const protection = await pcAppWriteProtectionResponse(); if (protection) return protection;
    if (typeof body.attemptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.attemptId)) return NextResponse.json({ error: "登録条件が不正です" }, { status: 400 });
    try { return receiptResponse(await registerGoogleSheetResource(authorization.supabase, body.attemptId), true); } catch (error) { return failedRead(error); }
  }
  if (body.mode !== undefined) return NextResponse.json({ error: "発行条件が不正です" }, { status: 400 });
  if (body.scheduleIds !== undefined && (!Array.isArray(body.scheduleIds) || !body.scheduleIds.every(id => typeof id === "string")
    || new Set(body.scheduleIds).size !== body.scheduleIds.length)) return NextResponse.json({ error: "選択した予定が不正です" }, { status: 400 });
  if (
    !["practice", "meet", "time_trial"].includes(body.kind) ||
    !["all", "middle_long", "short", "jump", "throw"].includes(body.block)
  ) {
    return NextResponse.json({ error: "発行条件が不正です" }, { status: 400 });
  }
  const spec = { kind: body.kind, block: body.block, year: body.kind === "practice" ? body.year ?? null : null, month: body.kind === "practice" ? body.month ?? null : null };
  if (!validCreationSpec(spec)) {
    return NextResponse.json({ error: "対象年月を選択してください" }, { status: 400 });
  }
  if (!validWeekdayDefaults(body.weekdayDefaults)) {
    return NextResponse.json({ error: "曜日ごとの設定が不正です" }, { status: 400 });
  }

  const authorization = await authorizedUser();
  if (authorization instanceof Response) return authorization;
  const { supabase, user } = authorization;

  const admin = createAdminClient();
  const protectedResponse = await pcAppWriteProtectionResponse();
  if (protectedResponse) return protectedResponse;
  const { data: connection, error: connectionError } = await admin
    .from("google_drive_connections")
    .select("refresh_token_encrypted,connected_at")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (connectionError) return failedRead(connectionError);
  if (!connection) {
    return NextResponse.json({ error: "Google Driveを連携してください" }, { status: 409 });
  }

  const [venueResult, scheduleResult] = await Promise.all([
    supabase.from("venues").select("*").order("sort", { ascending: true }).order("id", { ascending: true }),
    body.scheduleIds?.length
      ? supabase
          .from("practice_schedules")
          .select("*")
          .in("id", body.scheduleIds)
          .eq("schedule_type", body.kind)
          .order("schedule_date", { ascending: true }).order("id", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (venueResult.error || scheduleResult.error) return failedRead(venueResult.error ?? scheduleResult.error);
  if (!Array.isArray(venueResult.data) || !Array.isArray(scheduleResult.data)) return failedRead(new Error("Creation input unavailable"));
  const venueData = venueResult.data;
  const schedules = (scheduleResult.data ?? []) as PracticeSchedule[];
  if (body.scheduleIds?.length && schedules.length !== body.scheduleIds.length) {
    return NextResponse.json(
      { error: "選択した予定の一部を取得できませんでした" },
      { status: 400 },
    );
  }

  let created: CreatedSpreadsheet | undefined;
  let receipt: CreationReceipt | undefined;
  try {
    const input = { title: sheetTitle(body), kind: body.kind, year: spec.year, month: spec.month, block: body.block,
      venues: (venueData ?? []) as VenueRow[], schedules, weekdayDefaults: body.kind === "practice" ? body.weekdayDefaults ?? [] : [] };
    let held: CreationReceipt | null;
    try { held = await readGoogleSheetCreation(supabase); } catch (error) { return failedRead(error); }
    if (held && (held.state !== "registered" || !held.setup_confirmed)) return receiptResponse(held);
    const refreshToken = decryptGoogleToken(connection.refresh_token_encrypted);
    const tokens = await refreshGoogleAccessToken(refreshToken);
    receipt = await beginGoogleSheetCreation(supabase, connection, spec, scheduleSpreadsheetFingerprint(input));
    if (receipt.outcome !== "send") return receiptResponse(receipt);
    created = await createScheduleSpreadsheet({
      ...input,
      accessToken: tokens.access_token,
      onCreated: async resource => { receipt = await rememberGoogleSheetResource(admin, receipt!, user.id, resource); },
    });
    receipt = await rememberGoogleSheetSetup(admin, receipt!, user.id, created);
    return receiptResponse(await registerGoogleSheetResource(supabase, receipt.attempt_id));
  } catch (error) {
    if (error instanceof GoogleSheetCreationReceiptError) return NextResponse.json({ error: error.message,
      code: error.protection ? "PC_BACKUP_UNAVAILABLE" : "SHEET_CREATION_HELD", outcome: error.resource ? "partial" : "unknown",
      phase: error.phase, attemptId: error.attemptId, resource: error.resource, resultUnknown: error.resultUnknown, retryable: false },
    { status: error.protection ? 503 : 502, headers: privateHeaders });
    if (error instanceof SpreadsheetCreationError || created) {
      const partial = error instanceof SpreadsheetCreationError ? error : new SpreadsheetCreationError("partial", "record", created!, !!pcBackupProtectionResponse(error));
      return NextResponse.json({ error: partial.message, code: partial.protection ? "PC_BACKUP_UNAVAILABLE" : "SHEET_CREATION_INCOMPLETE",
        outcome: partial.outcome, phase: partial.phase, attemptId: receipt?.attempt_id, retryable: false, resultUnknown: partial.outcome === "unknown", resource: partial.resource },
      { status: partial.protection ? 503 : 502, headers: { "cache-control": "private, no-store" } });
    }
    const protection = pcBackupProtectionResponse(error);
    if (protection) return protection;
    if (receipt) return receiptResponse(receipt);
    return NextResponse.json(
      { error: "スプレッドシートを発行できませんでした。再連携を試してください" },
      { status: 500 },
    );
  }
}

function validWeekdayDefaults(
  defaults: ScheduleSheetWeekdayDefault[] | undefined,
): boolean {
  if (defaults === undefined) return true;
  if (!Array.isArray(defaults) || defaults.length > 7) return false;
  const weekdays = new Set<number>();
  return defaults.every((item) => {
    if (
      !Number.isInteger(item.weekday) ||
      item.weekday < 0 ||
      item.weekday > 6 ||
      weekdays.has(item.weekday) ||
      typeof item.time !== "string" ||
      (item.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) ||
      typeof item.venueName !== "string" ||
      item.venueName.length > 200
    ) {
      return false;
    }
    weekdays.add(item.weekday);
    return true;
  });
}

function sheetTitle(body: RequestBody): string {
  const block = body.block === "all" ? "全体" : BLOCKS[body.block].label;
  if (body.kind === "practice") {
    return `${body.year}年${body.month}月 練習予定（${block}）`;
  }
  return `${body.kind === "meet" ? "大会" : "記録会"}予定（${block}）`;
}
