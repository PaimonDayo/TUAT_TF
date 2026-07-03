import type {
  Block,
  PracticeSchedule,
  ScheduleImportEditableRow,
  ScheduleImportPreview,
  ScheduleImportRow,
  ScheduleSheet,
  VenueRow,
} from "@/types";

export const BLOCK_LABELS: Record<string, "all" | Block> = {
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

export const PRACTICE_IMPORT_COLUMNS = [
  "予定ID",
  "日付",
  "曜日",
  "対象ブロック",
  "時間",
  "場所",
  "詳細",
  "メニュー",
  "ペース",
  "補足",
  "補強",
];

export const EVENT_IMPORT_COLUMNS = [
  "予定ID",
  "名称",
  "開始日",
  "終了日",
  "場所",
  "エントリー開始日",
  "エントリー締切日",
  "対象ブロック",
  "詳細",
];

export type SubmittedScheduleRow = {
  rowNumber: number;
  values: Record<string, string>;
};

const BOM_PATTERN = /^﻿/;

/**
 * 冒頭の自由メモ行を飛ばして見出し行を探す。
 * practice: 「曜日・時間・場所」を全部含む行を見出しとみなす。
 * meet/time_trial: 「開始日」または「日付」を含む行を見出しとみなす。
 * 見つからなければ従来どおり先頭行（index 0）を見出しとみなす。
 */
export function detectHeaderRowIndex(rows: string[][], sheet: ScheduleSheet): number {
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

/**
 * 見出し行のセル配列を整形する。実物スプシは日付列の見出しテキストが
 * 固定名でない（例: 数字が入っている）ことがあるため、practice kindは
 * 常に先頭列＝日付として扱う（位置ベース）。
 */
export function buildHeaderRow(rawRow: string[] | undefined, sheet: ScheduleSheet): string[] {
  const headerRow = (rawRow ?? []).map((h) => h.replace(BOM_PATTERN, "").trim());
  if (sheet.kind === "practice" && headerRow.length > 0) {
    headerRow[0] = "日付";
  }
  return headerRow;
}

export function googleSheetCsvUrl(value: string): URL {
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

export function validateScheduleImportRows({
  rows,
  sheet,
  existing,
  venues,
  includeDeletions,
}: {
  rows: SubmittedScheduleRow[];
  sheet: ScheduleSheet;
  existing: PracticeSchedule[];
  venues: VenueRow[];
  includeDeletions: boolean;
}): ScheduleImportPreview {
  const preview: ScheduleImportPreview = {
    columns:
      sheet.kind === "practice"
        ? PRACTICE_IMPORT_COLUMNS
        : EVENT_IMPORT_COLUMNS,
    rows: [],
    additions: [],
    updates: [],
    deletions: [],
    errors: [],
    skips: [],
  };
  const usedIds = new Set<string>();
  const byDate = new Map<string, PracticeSchedule[]>();
  for (const schedule of existing) {
    const sameDate = byDate.get(schedule.schedule_date) ?? [];
    sameDate.push(schedule);
    byDate.set(schedule.schedule_date, sameDate);
  }

  for (const submitted of rows) {
    const result = validateRow(
      submitted,
      sheet,
      existing,
      byDate,
      usedIds,
      venues,
    );
    preview.rows.push(result);
    if (result.status === "addition" && result.normalized) {
      preview.additions.push(result.normalized);
    } else if (result.status === "update" && result.normalized) {
      preview.updates.push(result.normalized);
    } else if (result.status === "error") {
      preview.errors.push({
        rowNumber: result.rowNumber,
        message: result.message ?? "入力内容を確認してください",
      });
    } else if (result.status === "skip") {
      preview.skips.push({
        rowNumber: result.rowNumber,
        message: result.message ?? "スキップ",
      });
    }
  }

  if (includeDeletions) {
    preview.deletions = existing.filter(
      (schedule) =>
        schedule.source_sheet_id === sheet.id && !usedIds.has(schedule.id),
    );
  }
  return preview;
}

function validateRow(
  submitted: SubmittedScheduleRow,
  sheet: ScheduleSheet,
  existing: PracticeSchedule[],
  byDate: Map<string, PracticeSchedule[]>,
  usedIds: Set<string>,
  venues: VenueRow[],
): ScheduleImportEditableRow {
  const values = normalizeImportValues(submitted.values);
  const result = (
    status: "error" | "skip",
    message: string,
  ): ScheduleImportEditableRow => ({
    rowNumber: submitted.rowNumber,
    values,
    status,
    message,
    normalized: null,
  });

  if (Object.values(values).every((value) => !value)) {
    return result("skip", "空行");
  }
  const hasContent =
    sheet.kind === "practice"
      ? [values["時間"], values["場所"], values["詳細"], values["メニュー"]].some(Boolean)
      : [
          values["名称"],
          values["開始日"],
          values["終了日"],
          values["場所"],
          values["エントリー開始日"],
          values["エントリー締切日"],
          values["詳細"],
        ].some(Boolean);
  if (!hasContent) return result("skip", "予定なし");

  const date = parseSheetDate(
    sheet.kind === "practice" ? values["日付"] : values["開始日"],
    sheet.target_year,
  );
  // 月末に翌月初日がはみ出す実物スプシ形式（例: 6月タブに7/1が混在）を許容するため、
  // 対象月そのものだけでなく前後1ヶ月までを許容範囲とする。
  const outsidePracticeMonth =
    sheet.kind === "practice" &&
    (!sheet.target_year ||
      !sheet.target_month ||
      !date ||
      !isWithinScheduleWindow(date, sheet.target_year, sheet.target_month));
  if (!date || outsidePracticeMonth) {
    return result(
      "error",
      sheet.kind === "practice"
        ? "日付が対象年月の前後1ヶ月から外れています"
        : "開始日は YYYY-MM-DD 形式で入力してください",
    );
  }

  const endDate =
    sheet.kind === "practice" ? null : parseOptionalDate(values["終了日"]);
  if (sheet.kind !== "practice" && values["終了日"] && !endDate) {
    return result("error", "終了日は YYYY-MM-DD 形式で入力してください");
  }
  if (endDate && endDate < date) {
    return result("error", "終了日は開始日以降にしてください");
  }

  const blockText = values["対象ブロック"];
  const block = blockText ? BLOCK_LABELS[blockText] : sheet.target_block;
  if (!block) {
    return result("error", `対象ブロックを確認してください: ${blockText}`);
  }
  const targetBlocks: Block[] = block === "all" ? [] : [block];

  const venueText = values["場所"] ?? "";
  const venue = venueText
    ? venues.find((item) => item.name === venueText || item.short === venueText)
    : undefined;
  const title = sheet.kind === "practice" ? "" : values["名称"] ?? "";
  if (sheet.kind !== "practice" && !title) {
    return result(
      "error",
      sheet.kind === "meet"
        ? "大会名を入力してください"
        : "記録会名を入力してください",
    );
  }

  const meetingTime =
    sheet.kind === "practice" ? parseTime(values["時間"]) : null;
  if (sheet.kind === "practice" && values["時間"] && !meetingTime) {
    return result("error", "時間は HH:mm 形式で入力してください");
  }

  const entryStart =
    sheet.kind === "practice"
      ? null
      : parseOptionalDate(values["エントリー開始日"]);
  const entryEnd =
    sheet.kind === "practice"
      ? null
      : parseOptionalDate(values["エントリー締切日"]);
  if (
    sheet.kind !== "practice" &&
    ((values["エントリー開始日"] && !entryStart) ||
      (values["エントリー締切日"] && !entryEnd))
  ) {
    return result(
      "error",
      "エントリー期間の日付は YYYY-MM-DD 形式で入力してください",
    );
  }
  if (entryStart && entryEnd && entryEnd < entryStart) {
    return result("error", "エントリー締切日は開始日以降にしてください");
  }

  const explicitId = values["予定ID"];
  const matched = explicitId
    ? existing.find(
        (schedule) =>
          schedule.id === explicitId && !usedIds.has(schedule.id),
      )
    : (byDate.get(date) ?? []).find(
        (schedule) =>
          !usedIds.has(schedule.id) &&
          sameBlocks(schedule.target_blocks ?? [], targetBlocks) &&
          (sheet.kind === "practice" || schedule.title === title),
      );
  if (explicitId && !matched) {
    return result("error", "選択した種類の既存予定を確認できません");
  }
  if (matched) usedIds.add(matched.id);

  const normalized: ScheduleImportRow = {
    rowNumber: submitted.rowNumber,
    id: matched?.id,
    schedule_date: date,
    end_date: endDate,
    schedule_type: sheet.kind,
    meeting_time: meetingTime,
    venue_name: venue?.name ?? (venueText || null),
    venue_access: venue?.access ?? null,
    venue_fee: venue?.fee ?? null,
    venue_url: venue?.url ?? null,
    title: title || null,
    entry_start: entryStart,
    entry_end: entryEnd,
    note: values["詳細"] || null,
    target_blocks: targetBlocks,
    menu_content: values["メニュー"] || null,
    menu_pace: values["ペース"] || null,
    menu_remark: values["補足"] || null,
    menu_supplement: values["補強"] || null,
  };
  return {
    rowNumber: submitted.rowNumber,
    values,
    status: matched ? "update" : "addition",
    message: matched ? "更新予定" : "追加予定",
    normalized,
  };
}

export function canonicalImportValues(
  raw: Record<string, string>,
  sheet: ScheduleSheet,
): Record<string, string> {
  if (sheet.kind === "practice") {
    return normalizeImportValues({
      "予定ID": raw["予定ID"],
      "日付": raw["日付"],
      "曜日": raw["曜日"],
      "対象ブロック": raw["対象ブロック"],
      "時間": raw["時間"],
      "場所": raw["場所"],
      "詳細": raw["詳細"],
      "メニュー": raw["メニュー"],
      "ペース": raw["ペース"],
      "補足": raw["補足"],
      "補強": raw["補強"],
    });
  }
  return normalizeImportValues({
    "予定ID": raw["予定ID"],
    "名称":
      raw[sheet.kind === "meet" ? "大会名" : "記録会名"] ??
      raw["名称"] ??
      raw["大会名"] ??
      raw["記録会名"],
    "開始日": raw["開始日"] ?? raw["日付"],
    "終了日": raw["終了日"],
    "場所": raw["場所"],
    "エントリー開始日": raw["エントリー開始日"],
    "エントリー締切日": raw["エントリー締切日"],
    "対象ブロック": raw["対象ブロック"],
    "詳細": raw["詳細"],
  });
}

export function normalizeImportValues(
  values: Record<string, string> | undefined,
) {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([key, value]) => [
      key.trim(),
      String(value ?? "").trim(),
    ]),
  );
}

export function requiredImportHeaders(sheet: ScheduleSheet): string[][] {
  return sheet.kind === "practice"
    ? [["日付"]]
    : [
        sheet.kind === "meet" ? ["大会名", "名称"] : ["記録会名", "名称"],
        ["開始日", "日付"],
      ];
}

function sameBlocks(left: Block[], right: Block[]): boolean {
  return [...left].sort().join(",") === [...right].sort().join(",");
}

export function parseSheetDate(
  value: string | undefined,
  defaultYear: number | null,
): string | null {
  const text = value?.trim();
  if (!text) return null;
  const normalized = text
    .replace(/年|月/g, "/")
    .replace(/日/g, "")
    .replace(/-/g, "/");
  const parts = normalized.split("/").filter(Boolean).map(Number);
  const [year, month, day] =
    parts.length === 3
      ? parts
      : parts.length === 2 && defaultYear
        ? [defaultYear, ...parts]
        : [];
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

/** 対象年月、またはその前後1ヶ月に収まっているか（タブ末尾の月またぎ対策） */
function isWithinScheduleWindow(
  date: string,
  targetYear: number,
  targetMonth: number,
): boolean {
  const [y, m] = date.split("-").map(Number);
  const monthIndex = (year: number, month: number) => year * 12 + (month - 1);
  const target = monthIndex(targetYear, targetMonth);
  const actual = monthIndex(y, m);
  return Math.abs(actual - target) <= 1;
}

function parseOptionalDate(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return parseSheetDate(value, null);
}

function parseTime(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
