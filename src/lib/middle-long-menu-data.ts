import type { PracticeMenu, ScheduleWithMenus } from "@/types";

export type MiddleLongSheetMenuRow = {
  exactDate: string | null;
  monthDay: string;
  sourceMonth: number;
  content: string;
  pace: string;
  remark: string;
  supplement: string;
};

export type MiddleLongMenuSnapshot = {
  rows: MiddleLongSheetMenuRow[];
  loadedMonths: number[];
};

function isMiddleLongBlockMenu(menu: PracticeMenu): boolean {
  return menu.target_block === "middle_long" && (menu.targets?.length ?? 0) === 0;
}

function sheetMenu(schedule: ScheduleWithMenus, row: MiddleLongSheetMenuRow): PracticeMenu | null {
  if (!row.content && !row.pace && !row.remark && !row.supplement) return null;
  const timestamp = `${schedule.schedule_date}T00:00:00.000Z`;
  return {
    id: `sheet-middle-long:${schedule.schedule_date}`,
    schedule_id: schedule.id,
    author_id: "",
    group_name: null,
    content: row.content,
    pace: row.pace || null,
    remark: row.remark || null,
    supplement: row.supplement || null,
    target_block: "middle_long",
    status: "published",
    created_at: timestamp,
    updated_at: timestamp,
    author: { display_name: "スプレッドシート" },
    targets: [],
    source: "sheet",
  };
}

/**
 * 読み込み済みの月はCSVを正として、中長距離のブロック共通メニューだけを置換する。
 * 個人指定メニューと他ブロックのメニューは維持する。
 */
export function applyMiddleLongMenuSnapshot(
  schedules: ScheduleWithMenus[],
  snapshot: MiddleLongMenuSnapshot,
): ScheduleWithMenus[] {
  const loadedMonths = new Set(snapshot.loadedMonths);
  return schedules.map((schedule) => {
    if (schedule.schedule_type !== "practice") return schedule;
    const month = Number(schedule.schedule_date.slice(5, 7));
    const monthDay = schedule.schedule_date.slice(5);
    const candidates = snapshot.rows.filter(
      (row) =>
        row.exactDate === schedule.schedule_date ||
        (row.exactDate === null && row.monthDay === monthDay),
    );
    const row = candidates.find((candidate) => candidate.sourceMonth === month) ?? candidates[0];

    if (!row && !loadedMonths.has(month)) return schedule;
    const menus = (schedule.menus ?? []).filter((menu) => !isMiddleLongBlockMenu(menu));
    const current = row ? sheetMenu(schedule, row) : null;
    return { ...schedule, menus: current ? [...menus, current] : menus };
  });
}

export function middleLongMenuMonths(schedules: ScheduleWithMenus[]): number[] {
  const months = new Set<number>();
  for (const schedule of schedules) {
    if (schedule.schedule_type !== "practice") continue;
    const month = Number(schedule.schedule_date.slice(5, 7));
    months.add(month);
    months.add(month === 1 ? 12 : month - 1);
  }
  return [...months].sort((a, b) => a - b);
}
