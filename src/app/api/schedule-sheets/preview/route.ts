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
    const parsed = Papa.parse<Record<string, string>>(csvResult.csv, {
      header: true,
      skipEmptyLines: false,
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
    });
    if (parsed.errors.some((error) => error.type === "Quotes")) {
      return NextResponse.json(
        { error: "CSVの引用符が正しく閉じられていません" },
        { status: 400 },
      );
    }
    const headers = parsed.meta.fields ?? [];
    const missing = requiredImportHeaders(sheet).filter(
      (choices) => !choices.some((header) => headers.includes(header)),
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
    rows = parsed.data.map((raw, index) => ({
      rowNumber: index + 2,
      values: canonicalImportValues(raw, sheet),
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
    const start = `${sheet.target_year}-${String(sheet.target_month).padStart(2, "0")}-01`;
    const nextMonth =
      sheet.target_month === 12
        ? `${sheet.target_year + 1}-01-01`
        : `${sheet.target_year}-${String(sheet.target_month + 1).padStart(2, "0")}-01`;
    query = query.gte("schedule_date", start).lt("schedule_date", nextMonth);
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
