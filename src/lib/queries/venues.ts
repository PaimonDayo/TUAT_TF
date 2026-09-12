// 練習場所の取得。

import { createClient } from "@/lib/supabase/server";

/** 会場一覧（管理用：全件） */
export async function getAllVenues() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("venues")
    .select("*")
    .order("sort", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as import("@/types").VenueRow[];
}
