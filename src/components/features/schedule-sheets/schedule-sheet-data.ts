import { BLOCKS } from "@/lib/constants";
import type { PracticeSchedule, ScheduleImportRow, ScheduleSheetBlock, ScheduleSheetKind, ScheduleSheetWeekdayDefault } from "@/types";

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export const INITIAL_WEEKDAY_DEFAULTS: ScheduleSheetWeekdayDefault[] = WEEKDAYS.map(
  (_, weekday) => ({
    weekday,
    time: weekday === 1 || weekday === 3 ? "17:00" : weekday === 6 ? "09:00" : "",
    venueName: "",
  }),
);

export function createTemplateRows(
  year: number,
  month: number,
  kind: ScheduleSheetKind,
  block: ScheduleSheetBlock,
): Record<string, string>[] {
  const days = new Date(year, month, 0).getDate();
  const blockName = block === "all" ? "全体" : BLOCKS[block].label;
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  if (kind !== "practice") {
    return Array.from({ length: 10 }, () => ({
      [kind === "meet" ? "大会名" : "記録会名"]: "",
      "開始日": "",
      "終了日": "",
      "場所": "",
      "エントリー開始日": "",
      "エントリー締切日": "",
      "対象ブロック": blockName,
      "詳細": "",
    }));
  }
  return Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const date = new Date(year, month - 1, day);
    const base = {
      "日付": `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      "曜日": weekdays[date.getDay()],
    };
    return {
      ...base,
      "対象ブロック": blockName,
      "時間": "",
      "場所": "",
      "詳細": "",
    };
  });
}

export function createExistingRows(
  schedules: PracticeSchedule[],
  kind: ScheduleSheetKind,
  block: ScheduleSheetBlock,
): Record<string, string>[] {
  const blockName = block === "all" ? "全体" : BLOCKS[block].label;
  if (kind === "practice") {
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    return schedules.map((schedule) => ({
      "予定ID": schedule.id,
      "日付": schedule.schedule_date,
      "曜日": weekdays[new Date(`${schedule.schedule_date}T00:00:00`).getDay()],
      "対象ブロック": blockName,
      "時間": schedule.meeting_time?.slice(0, 5) ?? "",
      "場所": schedule.venue_name ?? "",
      "詳細": schedule.note ?? "",
    }));
  }
  const titleKey = kind === "meet" ? "大会名" : "記録会名";
  return schedules.map((schedule) => ({
    "予定ID": schedule.id,
    [titleKey]: schedule.title ?? "",
    "開始日": schedule.schedule_date,
    "終了日": schedule.end_date ?? "",
    "場所": schedule.venue_name ?? "",
    "エントリー開始日": schedule.entry_start ?? "",
    "エントリー締切日": schedule.entry_end ?? "",
    "対象ブロック":
      schedule.target_blocks.length === 0
        ? "全体"
        : schedule.target_blocks.map((item) => BLOCKS[item].label).join(","),
    "詳細": schedule.note ?? "",
  }));
}

export function toRpcRow(row: ScheduleImportRow) {
  return {
    id: row.id ?? "",
    schedule_date: row.schedule_date,
    end_date: row.end_date ?? "",
    meeting_time: row.meeting_time ?? "",
    venue_name: row.venue_name ?? "",
    venue_access: row.venue_access ?? "",
    venue_fee: row.venue_fee ?? "",
    venue_url: row.venue_url ?? "",
    title: row.title ?? "",
    entry_start: row.entry_start ?? "",
    entry_end: row.entry_end ?? "",
    note: row.note ?? "",
    target_blocks: row.target_blocks,
    menu_content: row.menu_content ?? "",
    menu_pace: row.menu_pace ?? "",
    menu_remark: row.menu_remark ?? "",
    menu_supplement: row.menu_supplement ?? "",
  };
}
