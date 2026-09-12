// 走行距離ランキングの取得。

import { createClient } from "@/lib/supabase/server";
import type { WeeklyRankingRow, Block } from "@/types";

/** 週間ランキング（中長距離） */
export async function getWeeklyRanking(): Promise<WeeklyRankingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("weekly_ranking")
    .select("*")
    .order("total_km", { ascending: false });
  return (data ?? []).flatMap((row) => {
    if (!row.id || !row.display_name || !row.period_start || !row.period_end) return [];
    return [{
      id: row.id,
      display_name: row.display_name,
      grade: row.grade,
      blocks: (row.blocks ?? []).filter((block): block is Block =>
        block === "middle_long" || block === "short" || block === "manager" || block === "jump" || block === "throw"
      ),
      avatar_url: row.avatar_url,
      km_low: row.km_low ?? 0,
      km_mid: row.km_mid ?? 0,
      km_high: row.km_high ?? 0,
      km_speed: row.km_speed ?? 0,
      total_km: row.total_km ?? 0,
      km_other: row.km_other ?? 0,
      period_start: row.period_start,
      period_end: row.period_end,
    }];
  });
}
export async function getMonthlyRanking(
  periodStart: string,
  periodEnd: string,
): Promise<WeeklyRankingRow[]> {
  const supabase = await createClient();
  const { data: records, error } = await supabase
    .from("practice_records")
    .select("user_id, dist_low, dist_mid, dist_high, dist_speed, dist_actual")
    .gte("recorded_date", periodStart)
    .lte("recorded_date", periodEnd);
  if (error) throw new Error(`Failed to load monthly ranking: ${error.message}`);
  if (!records?.length) return [];

  const userIds = [...new Set(records.map((record) => record.user_id))];
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, grade, blocks, avatar_url")
    .in("id", userIds);
  if (profileError) throw new Error(`Failed to load ranking profiles: ${profileError.message}`);

  const totals = new Map<string, {
    km_low: number;
    km_mid: number;
    km_high: number;
    km_speed: number;
    km_other: number;
    total_km: number;
  }>();
  for (const record of records) {
    const current = totals.get(record.user_id) ?? {
      km_low: 0, km_mid: 0, km_high: 0, km_speed: 0, km_other: 0, total_km: 0,
    };
    current.km_low += record.dist_low ?? 0;
    current.km_mid += record.dist_mid ?? 0;
    current.km_high += record.dist_high ?? 0;
    current.km_speed += record.dist_speed ?? 0;
    const intensityTotal = (record.dist_low ?? 0) + (record.dist_mid ?? 0) + (record.dist_high ?? 0) + (record.dist_speed ?? 0);
    current.km_other += Math.max((record.dist_actual ?? 0) - intensityTotal, 0);
    current.total_km += Math.max(intensityTotal, record.dist_actual ?? 0);
    totals.set(record.user_id, current);
  }

  const rounded = (value: number) => Math.round(value * 100) / 100;
  return (profiles ?? []).flatMap((profile) => {
    const blocks = (profile.blocks ?? []).filter((block): block is Block =>
      block === "middle_long" || block === "short" || block === "manager" || block === "jump" || block === "throw"
    );
    const values = totals.get(profile.id);
    if (!values || !blocks.includes("middle_long") || values.total_km <= 0) return [];
    return [{
      id: profile.id,
      display_name: profile.display_name,
      grade: profile.grade,
      blocks,
      avatar_url: profile.avatar_url,
      km_low: rounded(values.km_low),
      km_mid: rounded(values.km_mid),
      km_high: rounded(values.km_high),
      km_speed: rounded(values.km_speed),
      km_other: rounded(values.km_other),
      total_km: rounded(values.total_km),
      period_start: periodStart,
      period_end: periodEnd,
    }];
  }).sort((a, b) => b.total_km - a.total_km);
}
