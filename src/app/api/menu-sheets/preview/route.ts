import { NextResponse } from "next/server";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/server";
import {
  canonicalMenuImportValues,
  requiredMenuImportHeaders,
  validateMenuImportRows,
  type SubmittedMenuRow,
} from "@/lib/menu-import";
import { normalizeImportValues } from "@/lib/schedule-import";
import type { Block, PracticeMenu, PracticeSchedule } from "@/types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    year?: number;
    targetBlock?: Block;
    sheetUrl?: string;
    csv?: string;
    rows?: SubmittedMenuRow[];
  };
  const year = Number(body.year);
  const targetBlock = body.targetBlock;
  if (!year || !targetBlock) {
    return NextResponse.json({ error: "対象年とブロックを指定してください" }, { status: 400 });
  }

  let rows: SubmittedMenuRow[];
  const editedRows = Array.isArray(body.rows);
  if (editedRows) {
    rows = body.rows!.map((row, index) => ({
      rowNumber: Number.isInteger(row.rowNumber) ? row.rowNumber : index + 2,
      values: normalizeImportValues(row.values),
    }));
  } else {
    const csvResult = await loadCsv(body.sheetUrl, body.csv);
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
    const missing = requiredMenuImportHeaders().filter(
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
      values: canonicalMenuImportValues(raw),
    }));
  }

  const supabase = await createClient();
  const start = `${year - 1}-12-01`;
  const end = `${year + 1}-02-01`;
  const { data: scheduleData } = await supabase
    .from("practice_schedules")
    .select("*")
    .eq("schedule_type", "practice")
    .gte("schedule_date", start)
    .lt("schedule_date", end);
  const schedules = (scheduleData ?? []) as PracticeSchedule[];
  const scheduleIds = schedules.map((schedule) => schedule.id);

  let menus: PracticeMenu[] = [];
  if (scheduleIds.length > 0) {
    const { data: menuData } = await supabase
      .from("practice_menus")
      .select("*, targets:practice_menu_targets(menu_id, user_id)")
      .in("schedule_id", scheduleIds);
    menus = (menuData ?? []) as PracticeMenu[];
  }

  return NextResponse.json(
    validateMenuImportRows({
      rows,
      defaultYear: year,
      defaultBlock: targetBlock,
      schedules,
      menus,
    }),
  );
}

async function loadCsv(
  sheetUrl?: string,
  uploadedCsv?: string,
): Promise<{ csv: string } | { error: string; status: number }> {
  if (uploadedCsv) return { csv: uploadedCsv };
  if (!sheetUrl?.trim()) {
    return { error: "GoogleスプレッドシートのURLかCSVファイルを指定してください", status: 400 };
  }
  let csvUrl: URL;
  try {
    csvUrl = googleSheetCsvUrl(sheetUrl.trim());
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
