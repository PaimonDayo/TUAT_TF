import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createScheduleSpreadsheet,
  decryptGoogleToken,
  refreshGoogleAccessToken,
} from "@/lib/google-drive";
import { BLOCKS } from "@/lib/constants";
import type {
  PracticeSchedule,
  ScheduleSheetBlock,
  ScheduleSheetKind,
  ScheduleSheetWeekdayDefault,
  VenueRow,
} from "@/types";

type RequestBody = {
  kind: ScheduleSheetKind;
  block: ScheduleSheetBlock;
  year?: number;
  month?: number;
  scheduleIds?: string[];
  weekdayDefaults?: ScheduleSheetWeekdayDefault[];
};

export async function POST(request: Request) {
  const body = (await request.json()) as RequestBody;
  if (
    !["practice", "meet", "time_trial"].includes(body.kind) ||
    !["all", "middle_long", "short", "jump", "throw"].includes(body.block)
  ) {
    return NextResponse.json({ error: "発行条件が不正です" }, { status: 400 });
  }
  if (body.kind === "practice" && (!body.year || !body.month)) {
    return NextResponse.json({ error: "対象年月を選択してください" }, { status: 400 });
  }
  if (!validWeekdayDefaults(body.weekdayDefaults)) {
    return NextResponse.json({ error: "曜日ごとの設定が不正です" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  const { data: canCreate } = await supabase.rpc("can_create_schedule");
  if (!canCreate) {
    return NextResponse.json({ error: "予定作成権限がありません" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("google_drive_connections")
    .select("refresh_token_encrypted")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!connection) {
    return NextResponse.json({ error: "Google Driveを連携してください" }, { status: 409 });
  }

  const [{ data: venueData }, scheduleResult] = await Promise.all([
    supabase.from("venues").select("*").order("sort", { ascending: true }),
    body.scheduleIds?.length
      ? supabase
          .from("practice_schedules")
          .select("*")
          .in("id", body.scheduleIds)
          .eq("schedule_type", body.kind)
          .order("schedule_date", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);
  const schedules = (scheduleResult.data ?? []) as PracticeSchedule[];
  if (body.scheduleIds?.length && schedules.length !== body.scheduleIds.length) {
    return NextResponse.json(
      { error: "選択した予定の一部を取得できませんでした" },
      { status: 400 },
    );
  }

  try {
    const refreshToken = decryptGoogleToken(connection.refresh_token_encrypted);
    const tokens = await refreshGoogleAccessToken(refreshToken);
    const title = sheetTitle(body);
    const created = await createScheduleSpreadsheet({
      accessToken: tokens.access_token,
      title,
      kind: body.kind,
      year: body.kind === "practice" ? body.year! : null,
      month: body.kind === "practice" ? body.month! : null,
      block: body.block,
      venues: (venueData ?? []) as VenueRow[],
      schedules,
      weekdayDefaults: body.kind === "practice" ? body.weekdayDefaults ?? [] : [],
    });
    const { data: sheet, error: saveError } = await supabase
      .from("schedule_sheets")
      .insert({
        author_id: user.id,
        target_year: body.kind === "practice" ? body.year : null,
        target_month: body.kind === "practice" ? body.month : null,
        kind: body.kind,
        target_block: body.block,
        sheet_url: created.url,
        csv_url: created.url,
      })
      .select("id")
      .single();
    if (saveError || !sheet) throw saveError ?? new Error("Sheet record was not saved");
    return NextResponse.json({
      id: sheet.id,
      url: created.url,
      spreadsheetId: created.spreadsheetId,
    });
  } catch (error) {
    console.error("Google spreadsheet creation failed", error);
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
