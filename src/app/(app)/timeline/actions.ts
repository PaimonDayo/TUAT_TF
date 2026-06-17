"use server";

import { getFeed } from "@/lib/queries";
import { getCurrentProfile } from "@/lib/supabase/auth";
import type { Block, FeedItem } from "@/types";

/** 「もっと見る」用：limit を増やして再取得する */
export async function loadFeed(
  block: string,
  grade: string,
  limit: number,
): Promise<FeedItem[]> {
  const profile = await getCurrentProfile();
  return getFeed(profile.id, (block as Block) || "all", limit, grade || "all");
}
