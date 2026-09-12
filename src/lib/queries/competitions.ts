// 大会・種目・目標・結果の取得。

import { createClient } from "@/lib/supabase/server";
import { jstToday } from "@/lib/date";
import type { CompetitionRow, CompetitionGoalRow, PersonalBestRow, PbRecord } from "@/types";

export const COMPETITION_SELECT = "id,name,starts_on,ends_on,sort_order,is_countdown";
/** 部で統一している大会（対抗戦など）の一覧 */
export async function getCompetitions() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("competitions")
    .select(COMPETITION_SELECT)
    .order("sort_order")
    .order("starts_on", { ascending: false });
  return (data ?? []) as CompetitionRow[];
}

/** 種目マスタ（表示順） */
export async function getCompetitionEvents() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("competition_events")
    .select("name,sort_order,measure_type,time_format")
    .order("sort_order")
    .order("name");
  return data ?? [];
}

/** ホームのカウントダウンとみんなの目標。管理者が選んだ大会（無ければ非表示） */
export async function getHomeCompetition() {
  const supabase = await createClient();
  const { data: competition, error } = await supabase
    .from("competitions")
    .select(COMPETITION_SELECT)
    .eq("is_countdown", true)
    .maybeSingle();
  if (error || !competition) return null;
  const { count } = await supabase
    .from("competition_goals")
    .select("user_id", { count: "exact", head: true })
    .eq("competition_id", competition.id);
  return { competition: competition as CompetitionRow, goalCount: count ?? 0 };
}

/** 目標一覧ページ（大会別）。目標の横に出す本人のPBも一緒に読む */
export async function getCompetitionGoals(competitionId: string) {
  const supabase = await createClient();
  const [{ data: goals }, events, competitions] = await Promise.all([
    supabase
      .from("competition_goals")
      .select("id,user_id,event,target,author:profiles!user_id(display_name,blocks)")
      .eq("competition_id", competitionId),
    getCompetitionEvents(),
    getCompetitions(),
  ]);
  const rows = (goals ?? []) as unknown as CompetitionGoalRow[];
  const userIds = [...new Set(rows.map((g) => g.user_id))];
  const { data: bests } = userIds.length
    ? await supabase
        .from("pb_records")
        .select("user_id,event_name,record,value_cs,value_cm,value_points,result_status")
        .eq("is_pb", true)
        .in("user_id", userIds)
    : { data: [] };
  return {
    goals: rows,
    events,
    competitions,
    personalBests: (bests ?? []) as PersonalBestRow[],
  };
}

/** ある大会の結果（大会別の一覧ページ用） */
export async function getCompetitionResults(competitionId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pb_records")
    .select("*,author:profiles!user_id(display_name)")
    .eq("competition_id", competitionId)
    .order("event_name");
  return (data ?? []) as unknown as (PbRecord & {
    author: { display_name: string } | null;
  })[];
}

/** 結果に入力されているがマスタに無い種目名（表記統一の入口） */
export async function getUnregisteredEventNames() {
  const supabase = await createClient();
  const [{ data: records }, events] = await Promise.all([
    supabase.from("pb_records").select("event_name"),
    getCompetitionEvents(),
  ]);
  const known = new Set(events.map((e) => e.name));
  const counts = new Map<string, number>();
  for (const row of records ?? []) {
    if (known.has(row.event_name)) continue;
    counts.set(row.event_name, (counts.get(row.event_name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
}

export async function getCompetitionById(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("competitions")
    .select(COMPETITION_SELECT)
    .eq("id", id)
    .maybeSingle();
  return (data as CompetitionRow | null) ?? null;
}

/**
 * 目標ページ（マイページ→目標）のハブ用。
 * 大会を「これから／終わった」に分け、自分が設定済みの目標件数を大会ごとに数える。
 * 終了日が無い大会は開催日そのものを終了日として扱う。
 */
export async function getGoalHub(userId: string) {
  const supabase = await createClient();
  const today = jstToday();
  const [competitions, { data: goals }] = await Promise.all([
    getCompetitions(),
    supabase
      .from("competition_goals")
      .select("competition_id")
      .eq("user_id", userId),
  ]);
  const myGoalCounts = new Map<string, number>();
  for (const row of goals ?? [])
    myGoalCounts.set(
      row.competition_id,
      (myGoalCounts.get(row.competition_id) ?? 0) + 1,
    );
  const isOver = (row: CompetitionRow) =>
    (row.ends_on ?? row.starts_on) < today;
  return {
    upcoming: competitions
      .filter((row) => !isOver(row))
      .sort((a, b) => a.starts_on.localeCompare(b.starts_on)),
    past: competitions
      .filter(isOver)
      .sort((a, b) => b.starts_on.localeCompare(a.starts_on)),
    myGoalCounts,
  };
}
