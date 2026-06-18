import { Header } from "@/components/layout/Header";
import { TimelineView } from "@/components/features/TimelineView";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getFeed } from "@/lib/queries";

export default async function TimelinePage() {
  const profile = await getCurrentProfile();
  // 絞り込みはクライアント側で行うため、ここでは全件をまとめて取得する。
  const feed = await getFeed(profile.id, "all", 30, "all");

  return (
    <>
      <Header title="タイムライン" large />
      <TimelineView initialItems={feed} currentUserId={profile.id} />
    </>
  );
}
