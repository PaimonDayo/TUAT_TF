// 練習予定と出欠の取得。

import { createClient } from "@/lib/supabase/server";
import { viewerCompetitionBlocks } from "@/lib/constants";
import { jstToday } from "@/lib/date";
import { normalizeScheduleRow } from "@/lib/query-normalize";
import { normalizeAuthorRow } from "@/lib/profile-normalize";
import type { Block } from "@/types";
import { isPresent } from "./internal";

/** ある日付の練習予定を取得 */
export async function getSchedulesOn(date: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("practice_schedules")
    .select("*")
    .eq("schedule_date", date)
    .order("meeting_time", { ascending: true });
  return data ?? [];
}
/** 今日以降の練習予定（メニュー込み）を取得 */
function filterSchedulesForViewer<T extends { target_blocks?: string[] | null }>(
  schedules: T[],
  viewerBlocks: Block[],
  canManage: boolean,
): T[] {
  if (canManage) return schedules;
  const viewerBlockSet = new Set<string>(viewerCompetitionBlocks(viewerBlocks));
  return schedules.filter((schedule) => {
    const targets = schedule.target_blocks ?? [];
    return targets.length === 0 || targets.some((block) => viewerBlockSet.has(block));
  });
}

/**
 * 「今後の予定」に残す条件。複数日開催（大会など）は初日を過ぎても
 * 最終日までは今後の予定に出し続ける。終了日が無い予定は開催日そのもので判定する。
 */
export function stillRunningOrUpcoming(today: string) {
  return `schedule_date.gte.${today},end_date.gte.${today}`;
}

export async function getUpcomingSchedules(
  viewerBlocks: Block[],
  canManage: boolean,
  type?: string,
) {
  const supabase = await createClient();
  const today = jstToday();
  let q = supabase
    .from("practice_schedules")
    .select(`
      *,
      menus:practice_menus(
        *,
        author:profiles!author_id(id, display_name),
        targets:practice_menu_targets(
          menu_id,
          user_id,
          profile:profiles!user_id(id, display_name, avatar_url, blocks, grade)
        )
      )
    `)
    .or(stillRunningOrUpcoming(today))
    .order("schedule_date", { ascending: true })
    .order("meeting_time", { ascending: true, nullsFirst: false });
  if (type && type !== "all") q = q.eq("schedule_type", type);
  const { data, error } = await q;
  if (error) throw new Error("Failed to load upcoming schedules: " + error.message);
  return filterSchedulesForViewer(data ?? [], viewerBlocks, canManage)
    .map(normalizeScheduleRow)
    .filter(isPresent);
}

/** 予定一覧用。出欠を同じクエリに含め、一覧初期表示の往復を減らす。 */
export async function getUpcomingSchedulesWithAttendances(
  viewerBlocks: Block[],
  canManage: boolean,
  limit = 200,
) {
  const supabase = await createClient();
  const today = jstToday();
  const { data, error } = await supabase
    .from("practice_schedules")
    .select(`
      *,
      menus:practice_menus(
        *,
        author:profiles!author_id(id, display_name),
        targets:practice_menu_targets(
          menu_id,
          user_id,
          profile:profiles!user_id(id, display_name, avatar_url, blocks, grade)
        )
      ),
      attendances(
        schedule_id,
        attend_date,
        user_id,
        status,
        is_late,
        late_note,
        absence_note,
        profile:profiles!user_id(id, display_name, avatar_url, blocks, grade)
      )
    `)
    .or(stillRunningOrUpcoming(today))
    .order("schedule_date", { ascending: true })
    .order("meeting_time", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load upcoming schedules: ${error.message}`);
  return filterSchedulesForViewer(data ?? [], viewerBlocks, canManage)
    .map(normalizeScheduleRow)
    .filter(isPresent);
}
/** 出欠対象の今後の予定（出欠は別途取得） */
export async function getAttendanceSchedules(
  viewerBlocks: Block[],
  canManage: boolean,
  limit = 10,
) {
  const supabase = await createClient();
  const today = jstToday();
  const { data, error } = await supabase
    .from("practice_schedules")
    .select("*")
    .or(stillRunningOrUpcoming(today))
    .in("schedule_type", ["practice", "meet", "event"])
    .order("schedule_date", { ascending: true })
    .order("meeting_time", { ascending: true, nullsFirst: false })
    .limit(Math.max(30, limit * 3));
  if (error) throw new Error(`Failed to load attendance schedules: ${error.message}`);
  return filterSchedulesForViewer(data ?? [], viewerBlocks, canManage).slice(0, limit);
}

/** 指定した予定群の出欠（profile 付き） */
export async function getAttendancesForSchedules(scheduleIds: string[]) {
  if (scheduleIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendances")
    .select("schedule_id, attend_date, user_id, status, is_late, late_note, absence_note, profile:profiles!user_id(id, display_name, avatar_url, blocks, grade)")
    .in("schedule_id", scheduleIds);
  if (error) throw new Error("Failed to load attendances: " + error.message);
  return (data ?? []).flatMap((row) => {
    if (row.status !== "present" && row.status !== "absent") return [];
    return [{
      ...row,
      status: row.status as "present" | "absent",
      profile: normalizeAuthorRow(row.profile),
    }];
  });
}
