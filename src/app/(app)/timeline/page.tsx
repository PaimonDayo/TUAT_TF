import { cookies } from "next/headers";
import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { TimelineView } from "@/components/features/TimelineView";
import { FeedSkeleton } from "@/components/ui/page-skeletons";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getFeed, getMyFavoriteIds } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";

export default function TimelinePage() {
  return (
    <>
      <Header title="タイムライン" large />
      <Suspense fallback={<FeedSkeleton />}>
        <TimelineContent />
      </Suspense>
    </>
  );
}

async function TimelineContent() {
  const profile = await getCurrentProfile();
  const [feed, favoriteIds, cookieStore] = await Promise.all([
    getFeed(profile.id, 30),
    getMyFavoriteIds(profile.id),
    cookies(),
  ]);
  const initialCompact = cookieStore.get("timeline-compact")?.value === "1";
  const showRecordSource =
    permissionsOf(profile.roles).manageSystem &&
    cookieStore.get("show-record-source")?.value === "1";

  return (
    <TimelineView
      initialItems={feed}
      currentUser={{
        id: profile.id,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      }}
      favoriteIds={favoriteIds}
      initialCompact={initialCompact}
      showRecordSource={showRecordSource}
    />
  );
}
