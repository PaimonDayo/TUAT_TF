import { NextResponse } from "next/server";
import Papa from "papaparse";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildHeaderRow,
  canonicalImportValues,
  detectHeaderRowIndex,
  googleSheetCsvUrl,
  validateScheduleImportRows,
  type SubmittedScheduleRow,
} from "@/lib/schedule-import";
import type { PracticeSchedule, ScheduleSheet, VenueRow } from "@/types";

export const maxDuration = 60;

/**
 * 登録済みの予定スプレッドシートを定期的に自動取込する（pg_cronから叩く想定）。
 * 認可: `Authorization: Bearer <SHEET_SYNC_SECRET>` のみ。
 * 非破壊: 追加・更新のみ行い、削除は行わない（アプリ側から手動で行う）。
 * 予定のメニュー/ペース/補足/補強列は、対応する予定にブロック全体メニューとして
 * 生成/更新する（apply_schedule_sheet_importと同じロジックをservice roleで再現）。
 */
export async function POST(request: Request) {
  const secret = process.env.SHEET_SYNC_SECRET;
  const authHeader = request.headers.get("authorization") ?? "";
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: sheets, error: sheetsError } = await admin
    .from("schedule_sheets")
    .select("*")
    .eq("status", "active")
    .not("csv_url", "is", null);
  if (sheetsError) {
    return NextResponse.json({ error: "対象シートを取得できませんでした" }, { status: 500 });
  }

  const { data: venueData } = await admin.from("venues").select("*");
  const venues = (venueData ?? []) as VenueRow[];

  const results: Record<string, unknown>[] = [];
  for (const sheet of (sheets ?? []) as ScheduleSheet[]) {
    try {
      const summary = await syncOneSheet(admin, sheet, venues);
      results.push({ sheetId: sheet.id, kind: sheet.kind, ...summary });
    } catch (err) {
      results.push({
        sheetId: sheet.id,
        kind: sheet.kind,
        error: err instanceof Error ? err.message : "同期に失敗しました",
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}

async function syncOneSheet(
  admin: ReturnType<typeof createAdminClient>,
  sheet: ScheduleSheet,
  venues: VenueRow[],
) {
  const csvUrl = googleSheetCsvUrl(sheet.csv_url!);
  const response = await fetch(csvUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const csv = await response.text();

  const rawParsed = Papa.parse<string[]>(csv, { skipEmptyLines: false });
  const rawRows = rawParsed.data;
  const headerRowIndex = detectHeaderRowIndex(rawRows, sheet);
  const headerRow = buildHeaderRow(rawRows[headerRowIndex], sheet);

  const rows: SubmittedScheduleRow[] = rawRows.slice(headerRowIndex + 1).map((cells, index) => ({
    rowNumber: headerRowIndex + index + 2,
    values: canonicalImportValues(
      Object.fromEntries(headerRow.map((h, i) => [h, cells[i] ?? ""])),
      sheet,
    ),
  }));

  const existing = await loadExistingSchedules(admin, sheet);
  const preview = validateScheduleImportRows({
    rows,
    sheet,
    existing,
    venues,
    includeDeletions: false,
  });

  let inserted = 0;
  let updated = 0;
  let menuUpserts = 0;

  for (const row of [...preview.additions, ...preview.updates]) {
    let scheduleId = row.id ?? null;
    if (!scheduleId) {
      const { data, error } = await admin
        .from("practice_schedules")
        .insert({
          schedule_date: row.schedule_date,
          end_date: row.end_date,
          schedule_type: sheet.kind,
          meeting_time: row.meeting_time,
          venue_name: row.venue_name,
          venue_access: row.venue_access,
          venue_fee: row.venue_fee,
          venue_url: row.venue_url,
          title: row.title,
          entry_start: row.entry_start,
          entry_end: row.entry_end,
          note: row.note,
          target_blocks: row.target_blocks,
          source_sheet_id: sheet.id,
          created_by: sheet.author_id,
        })
        .select("id")
        .single();
      if (error || !data) continue;
      scheduleId = data.id as string;
      inserted++;
    } else {
      const { error } = await admin
        .from("practice_schedules")
        .update({
          schedule_date: row.schedule_date,
          end_date: row.end_date,
          meeting_time: row.meeting_time,
          venue_name: row.venue_name,
          venue_access: row.venue_access,
          venue_fee: row.venue_fee,
          venue_url: row.venue_url,
          title: row.title,
          entry_start: row.entry_start,
          entry_end: row.entry_end,
          note: row.note,
          target_blocks: row.target_blocks,
          source_sheet_id: sheet.id,
        })
        .eq("id", scheduleId);
      if (error) continue;
      updated++;
    }

    if (
      sheet.kind === "practice" &&
      row.target_blocks.length === 1 &&
      (row.menu_content || row.menu_pace || row.menu_remark || row.menu_supplement)
    ) {
      const applied = await upsertScheduleMenu(admin, sheet, scheduleId, row.target_blocks[0], row);
      if (applied) menuUpserts++;
    }
  }

  await admin
    .from("schedule_sheets")
    .update({ last_imported_at: new Date().toISOString() })
    .eq("id", sheet.id);

  return {
    scheduleInserted: inserted,
    scheduleUpdated: updated,
    menuUpserts,
    scheduleErrors: preview.errors.length,
  };
}

async function upsertScheduleMenu(
  admin: ReturnType<typeof createAdminClient>,
  sheet: ScheduleSheet,
  scheduleId: string,
  targetBlock: string,
  row: { menu_content?: string | null; menu_pace?: string | null; menu_remark?: string | null; menu_supplement?: string | null },
): Promise<boolean> {
  const { data: existingMenus } = await admin
    .from("practice_menus")
    .select("id, targets:practice_menu_targets(user_id)")
    .eq("schedule_id", scheduleId)
    .eq("target_block", targetBlock);
  const existing = ((existingMenus ?? []) as { id: string; targets: { user_id: string }[] }[]).find(
    (menu) => (menu.targets?.length ?? 0) === 0,
  );

  const payload = {
    content: row.menu_content || "",
    pace: row.menu_pace || null,
    remark: row.menu_remark || null,
    supplement: row.menu_supplement || null,
  };

  if (existing) {
    const { error } = await admin
      .from("practice_menus")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return !error;
  }
  const { error } = await admin.from("practice_menus").insert({
    schedule_id: scheduleId,
    author_id: sheet.author_id,
    target_block: targetBlock,
    status: "published",
    ...payload,
  });
  return !error;
}

async function loadExistingSchedules(
  admin: ReturnType<typeof createAdminClient>,
  sheet: ScheduleSheet,
): Promise<PracticeSchedule[]> {
  let query = admin
    .from("practice_schedules")
    .select("*")
    .eq("schedule_type", sheet.kind)
    .order("schedule_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (sheet.kind === "practice" && sheet.target_year && sheet.target_month) {
    const prevMonthDate = new Date(sheet.target_year, sheet.target_month - 2, 1);
    const nextMonthDate = new Date(sheet.target_year, sheet.target_month + 1, 1);
    const toDateStr = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    query = query
      .gte("schedule_date", toDateStr(prevMonthDate))
      .lt("schedule_date", toDateStr(nextMonthDate));
  }
  const { data } = await query;
  return (data ?? []) as PracticeSchedule[];
}
