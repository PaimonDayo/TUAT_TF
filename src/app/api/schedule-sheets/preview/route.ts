import { NextResponse } from "next/server";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/server";
import {
  canonicalImportValues,
  normalizeImportValues,
  requiredImportHeaders,
  type SubmittedScheduleRow,
  validateScheduleImportRows,
} from "@/lib/schedule-import";
import type {
  PracticeSchedule,
  ScheduleSheet,
  VenueRow,
} from "@/types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sheetId?: string;
    csv?: string;
    rows?: SubmittedScheduleRow[];
  };
  if (!body.sheetId) {
    return NextResponse.json({ error: "シートを指定してください" }, { status: 400 });
  }

  const supabase = await createClient();
  const [{ data: sheetData }, { data: venueData }] = await Promise.all([
    supabase.from("schedule_sheets").select("*").eq("id", body.sheetId).maybeSingle(),
    supabase.from("venues").select("*"),
  ]);
  const sheet = sheetData as ScheduleSheet | null;
  if (!sheet) {
    return NextResponse.json({ error: "シートを参照できません" }, { status: 404 });
  }

  let rows: SubmittedScheduleRow[];
  const editedRows = Array.isArray(body.rows);
  if (editedRows) {
    rows = body.rows!.map((row, index) => ({
      rowNumber: Number.isInteger(row.rowNumber) ? row.rowNumber : index + 2,
      values: normalizeImportValues(row.values),
    }));
  } else {
    const csvResult = await loadCsv(sheet, body.csv);
    if ("error" in csvResult) {
      return NextResponse.json({ error: csvResult.error }, { status: csvResult.status });
    }
    const rawParsed = Papa.parse<string[]>(csvResult.csv, { skipEmptyLines: false });
    if (rawParsed.errors.some((error) => error.type === "Quotes")) {
      return NextResponse.json(
        { error: "CSVの引用符が正しく閉じられていません" },
        { status: 400 },
      );
    }
    // 冒頭に自由メモ行が入る実物スプシ対応: 「曜日・時間・場所」等を含む行を
    // 見出し行として探す（見つからなければ従来どおり先頭行を見出しとみなす）。
    const rawRows = rawParsed.data;
    const headerRowIndex = detectHeaderRowIndex(rawRows, sheet);
    const headerRow = (rawRows[headerRowIndex] ?? []).map((h) =>
      h.replace(BOM_PATTERN, "").trim(),
    );
    const missing = requiredImportHeaders(sheet).filter(
      (choices) => !choices.some((header) => headerRow.includes(header)),
    );
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `必要な列がありません: ${missing
            .map((choices) => choices.join(" または "))
            .join("、")}`,
        },
        { status: 400 },
      );
    }
    rows = rawRows.slice(headerRowIndex + 1).map((cells, index) => ({
      rowNumber: headerRowIndex + index + 2,
      values: canonicalImportValues(
        Object.fromEntries(headerRow.map((h, i) => [h, cells[i] ?? ""])),
        sheet,
      ),
    }));
  }

  const existing = await loadExistingSchedules(supabase, sheet);
  return NextResponse.json(
    validateScheduleImportRows({
      rows,
      sheet,
      existing,
      venues: (venueData ?? []) as VenueRow[],
      includeDeletions: !editedRows,
    }),
  );
}

const BOM_PATTERN = /^﻿/;

/**
 * 冒頭の自由メモ行を飛ばして見出し行を探す。
 * practice: 「曜日・時間・場所」を全部含む行を見出しとみなす。
 * meet/time_trial: 「開始日」または「日付」を含む行を見出しとみなす。
 * 見つからなければ従来どおり先頭行（index 0）を見出しとみなす。
 */
function detectHeaderRowIndex(rows: string[][], sheet: ScheduleSheet): number {
  const normalizeCell = (cell: string) => cell.replace(BOM_PATTERN, "").trim();
  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i] ?? []).map(normalizeCell);
    if (sheet.kind === "practice") {
      if (["曜日", "時間", "場所"].every((anchor) => cells.includes(anchor))) return i;
    } else {
      if (cells.includes("開始日") || cells.includes("日付")) return i;
    }
  }
  return 0;
}

async function loadCsv(
  sheet: ScheduleSheet,
  uploadedCsv?: string,
): Promise<{ csv: string } | { error: string; status: number }> {
  if (uploadedCsv) return { csv: uploadedCsv };
  if (!sheet.csv_url) {
    return { error: "公開CSV URLを登録してください", status: 400 };
  }
  let csvUrl: URL;
  try {
    csvUrl = googleSheetCsvUrl(sheet.csv_url);
  } catch {
    return { error: "GoogleスプレッドシートのURLが不正です", status: 400 };
  }
  try {
    const response = await fetch(csvUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { csv: await response.text() };
  } catch {
    return {
      error: "スプレッドシートを読み込めませんでした。共有設定を確認してください",
      status: 502,
    };
  }
}

async function loadExistingSchedules(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sheet: ScheduleSheet,
): Promise<PracticeSchedule[]> {
  let query = supabase
    .from("practice_schedules")
    .select("*")
    .eq("schedule_type", sheet.kind)
    .order("schedule_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (sheet.kind === "practice" && sheet.target_year && sheet.target_month) {
    // 月またぎ（タブ末尾に翌月初日がはみ出す実物スプシ）を許容するため前後1ヶ月分を含める。
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

function googleSheetCsvUrl(value: string): URL {
  const url = new URL(value);
  if (!["docs.google.com", "docs.googleusercontent.com"].includes(url.hostname)) {
    throw new Error("unsupported host");
  }
  if (
    url.searchParams.get("output") === "csv" ||
    url.searchParams.get("format") === "csv"
  ) {
    return url;
  }
  const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) throw new Error("sheet id not found");
  const gid =
    url.searchParams.get("gid") ?? url.hash.match(/gid=(\d+)/)?.[1] ?? "0";
  return new URL(
    `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`,
  );
}
