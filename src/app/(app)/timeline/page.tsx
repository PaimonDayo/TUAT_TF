import { cookies } from "next/headers";
import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { TimelineView } from "@/components/features/TimelineView";
import { FeedSkeleton } from "@/components/ui/page-skeletons";
import { getCurrentProfile, getCurrentUserId } from "@/lib/supabase/auth";
import { getFeed, getMyFavoriteIds } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { RECORD_SOURCE_COOKIE, showRecordSourceFor } from "@/lib/record-source-display";

export default function TimelinePage() {
  return (
    <>
      <Header title="タイムライン" large />
      <Suspense fallback={<FeedSkeleton withHeader={false} />}>
        <TimelineContent />
      </Suspense>
    </>
  );
}

async function TimelineContent() {
  // 投稿もお気に入りも「自分のID」だけで引ける。プロフィールの取得を待ってから
  // 投げると、DBへの往復が1回ぶん直列に増える（PC中継では数百ミリ秒）。
  const userId = await getCurrentUserId();
  const [profile, feed, favoriteIds, cookieStore] = await Promise.all([
    getCurrentProfile(),
    getFeed(userId, 30),
    getMyFavoriteIds(userId),
    cookies(),
  ]);
  const initialCompact = cookieStore.get("timeline-compact")?.value === "1";
  const showRecordSource = showRecordSourceFor(
    permissionsOf(profile.roles).manageSystem,
    cookieStore.get(RECORD_SOURCE_COOKIE)?.value,
  );

  return (
    <TimelineView
      initialItems={feed}
      currentUser={{
        id: profile.id,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        systemRecordForm: Boolean(profile.sheet_name),
      }}
      favoriteIds={favoriteIds}
      initialCompact={initialCompact}
      initialBlock={profile.timeline_default_block}
      showRecordSource={showRecordSource}
    />
  );
}
