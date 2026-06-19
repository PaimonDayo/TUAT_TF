import { NextResponse } from "next/server";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/server";
import type {
  Block,
  PracticeSchedule,
  ScheduleImportPreview,
  ScheduleImportRow,
  ScheduleSheet,
  VenueRow,
} from "@/types";

const BLOCK_LABELS: Record<string, "all" | Block> = {
  all: "all",
  "全体": "all",
  "全員": "all",
  middle_long: "middle_long",
  "中長": "middle_long",
  "中長距離": "middle_long",
  short: "short",
  "短": "short",
  "短距離": "short",
  jump: "jump",
  "跳": "jump",
  "跳躍": "jump",
  throw: "throw",
  "投": "throw",
  "投擲": "throw",
};

export async function POST(request: Request) {
  const { sheetId } = (await request.json()) as { sheetId?: string };
  if (!sheetId) {
    return NextResponse.json({ error: "シートを指定してください" }, { status: 400 });
  }

  const supabase = await createClient();
  const [{ data: sheetData }, { data: venueData }] = await Promise.all([
    supabase.from("schedule_sheets").select("*").eq("id", sheetId).maybeSingle(),
    supabase.from("venues").select("*"),
  ]);
  const sheet = sheetData as ScheduleSheet | null;
  if (!sheet) {
    return NextResponse.json({ error: "シートを参照できません" }, { status: 404 });
  }
  if (!sheet.csv_url) {
    return NextResponse.json({ error: "公開CSV URLを登録してください" }, { status: 400 });
  }

  let csvUrl: URL;
  try {
    csvUrl = new URL(sheet.csv_url);
  } catch {
    return NextResponse.json({ error: "公開CSV URLが不正です" }, { status: 400 });
  }
  if (
    csvUrl.protocol !== "https:" ||
    !["docs.google.com", "docs.googleusercontent.com"].includes(csvUrl.hostname)
  ) {
    return NextResponse.json(
      { error: "Googleスプレッドシートの公開CSV URLを指定してください" },
      { status: 400 },
    );
  }

  let csv: string;
  try {
    const response = await fetch(csvUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    csv = await response.text();
  } catch {
    return NextResponse.json(
      { error: "公開CSVを読み込めませんでした。公開設定とURLを確認してください" },
      { status: 502 },
    );
  }

  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: false,
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
  });
  if (parsed.errors.some((error) => error.type === "Quotes")) {
    return NextResponse.json({ error: "CSVの引用符が正しく閉じられていません" }, { status: 400 });
  }

  const start = `${sheet.target_year}-${String(sheet.target_month).padStart(2, "0")}-01`;
  const nextMonth =
    sheet.target_month === 12
      ? `${sheet.target_year + 1}-01-01`
      : `${sheet.target_year}-${String(sheet.target_month + 1).padStart(2, "0")}-01`;
  const { data: existingData } = await supabase
    .from("practice_schedules")
    .select("*")
    .gte("schedule_date", start)
    .lt("schedule_date", nextMonth)
    .eq("schedule_type", sheet.kind)
    .order("schedule_date", { ascending: true })
    .order("created_at", { ascending: true });

  const targetBlocks: Block[] =
    sheet.target_block === "all" ? [] : [sheet.target_block];
  const existing = ((existingData ?? []) as PracticeSchedule[]).filter(
    (schedule) =>
      schedule.source_sheet_id === sheet.id ||
      sameBlocks(schedule.target_blocks ?? [], targetBlocks),
  );
  const venues = (venueData ?? []) as VenueRow[];
  const byDate = new Map<string, PracticeSchedule[]>();
  for (const schedule of existing) {
    const rows = byDate.get(schedule.schedule_date) ?? [];
    rows.push(schedule);
    byDate.set(schedule.schedule_date, rows);
  }

  const preview: ScheduleImportPreview = {
    additions: [],
    updates: [],
    deletions: [],
    errors: [],
    skips: [],
  };
  const usedIds = new Set<string>();

  parsed.data.forEach((raw, index) => {
    const rowNumber = index + 2;
    if (Object.values(raw).every((value) => !String(value ?? "").trim())) {
      preview.skips.push({ rowNumber, message: "空行" });
      return;
    }

    const date = parseSheetDate(raw["日付"], sheet.target_year);
    if (!date || !date.startsWith(`${sheet.target_year}-${String(sheet.target_month).padStart(2, "0")}-`)) {
      preview.errors.push({ rowNumber, message: "日付が対象年月内の有効な日付ではありません" });
      return;
    }

    const rowBlockText = raw["対象ブロック"]?.trim();
    const rowBlock = rowBlockText ? BLOCK_LABELS[rowBlockText] : sheet.target_block;
    if (!rowBlock || rowBlock !== sheet.target_block) {
      preview.errors.push({
        rowNumber,
        message: "対象ブロックが登録したシートの範囲と一致しません",
      });
      return;
    }

    const venueText = raw["場所"]?.trim() || "";
    const venue = venueText
      ? venues.find((item) => item.name === venueText || item.short === venueText)
      : undefined;
    if (venueText && !venue) {
      preview.errors.push({ rowNumber, message: `未登録の場所です: ${venueText}` });
      return;
    }

    const title = sheet.kind === "meet" ? raw["記録会名"]?.trim() || "" : "";
    if (sheet.kind === "meet" && !title) {
      preview.errors.push({ rowNumber, message: "記録会名を入力してください" });
      return;
    }

    const meetingTime =
      sheet.kind === "practice" ? parseTime(raw["時間"]) : null;
    if (sheet.kind === "practice" && raw["時間"]?.trim() && !meetingTime) {
      preview.errors.push({ rowNumber, message: "時間の形式が不正です" });
      return;
    }

    const entryStart =
      sheet.kind === "meet" ? parseOptionalDate(raw["エントリー開始日"], sheet.target_year) : null;
    const entryEnd =
      sheet.kind === "meet" ? parseOptionalDate(raw["エントリー締切日"], sheet.target_year) : null;
    if (
      sheet.kind === "meet" &&
      ((raw["エントリー開始日"]?.trim() && !entryStart) ||
        (raw["エントリー締切日"]?.trim() && !entryEnd))
    ) {
      preview.errors.push({ rowNumber, message: "エントリー期間の日付が不正です" });
      return;
    }

    const matched = (byDate.get(date) ?? []).find((schedule) => !usedIds.has(schedule.id));
    if (matched) usedIds.add(matched.id);
    const item: ScheduleImportRow = {
      rowNumber,
      id: matched?.id,
      schedule_date: date,
      schedule_type: sheet.kind,
      meeting_time: meetingTime,
      venue_name: venue?.name ?? null,
      venue_access: venue?.access ?? null,
      venue_fee: venue?.fee ?? null,
      venue_url: venue?.url ?? null,
      title: title || null,
      entry_start: entryStart,
      entry_end: entryEnd,
      note: raw["詳細"]?.trim() || null,
      target_blocks: targetBlocks,
    };
    if (matched) preview.updates.push(item);
    else preview.additions.push(item);
  });

  preview.deletions = existing.filter((schedule) => !usedIds.has(schedule.id));
  return NextResponse.json(preview);
}

function sameBlocks(left: Block[], right: Block[]): boolean {
  return [...left].sort().join(",") === [...right].sort().join(",");
}

function parseSheetDate(value: string | undefined, defaultYear: number): string | null {
  const text = value?.trim();
  if (!text) return null;
  const normalized = text.replace(/年|月/g, "/").replace(/日/g, "").replace(/-/g, "/");
  const parts = normalized.split("/").filter(Boolean).map(Number);
  const [year, month, day] =
    parts.length === 3 ? parts : parts.length === 2 ? [defaultYear, ...parts] : [];
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseOptionalDate(value: string | undefined, defaultYear: number): string | null {
  if (!value?.trim()) return null;
  return parseSheetDate(value, defaultYear);
}

function parseTime(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
