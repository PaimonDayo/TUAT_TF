"use server";

import { getFeed } from "@/lib/queries";
import { getCurrentProfile } from "@/lib/supabase/auth";
import type { FeedItem } from "@/types";

/** 「もっと見る」用：既取得分より古い投稿だけを追加取得する */
export async function loadFeed(
  cursors: {
    record?: { createdAt: string; id: string };
    tweet?: { createdAt: string; id: string };
  },
  limit = 30,
): Promise<FeedItem[]> {
  const profile = await getCurrentProfile();
  return getFeed(profile.id, limit, cursors);
}
