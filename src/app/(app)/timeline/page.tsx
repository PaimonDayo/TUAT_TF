import { cookies } from "next/headers";
import { Header } from "@/components/layout/Header";
import { TimelineView } from "@/components/features/TimelineView";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getFeed, getMyFavoriteIds } from "@/lib/queries";

export default async function TimelinePage() {
  const profile = await getCurrentProfile();
  // 絞り込みはクライアント側で行うため、ここでは全件をまとめて取得する。
  const [feed, favoriteIds, cookieStore] = await Promise.all([
    getFeed(profile.id, 30),
    getMyFavoriteIds(profile.id),
    cookies(),
  ]);
  const initialCompact = cookieStore.get("timeline-compact")?.value === "1";

  return (
    <>
      <Header title="タイムライン" large />
      <TimelineView
        initialItems={feed}
        currentUser={{
          id: profile.id,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
        }}
        favoriteIds={favoriteIds}
        initialCompact={initialCompact}
      />
    </>
  );
}
