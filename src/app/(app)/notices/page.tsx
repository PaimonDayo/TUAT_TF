import { SubHeader } from "@/components/layout/SubHeader";
import { NoticeCard } from "@/components/cards/NoticeCard";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getNotices } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { EmptyState } from "@/components/ui/empty-state";
import type { NoticeWithReactions } from "@/types";

export default async function NoticesPage() {
  const profile = await getCurrentProfile();
  const canCreateNotice = permissionsOf(profile.roles).createNotice;
  const notices = (await getNotices(profile.id)) as NoticeWithReactions[];

  return (
    <>
      <SubHeader
        title="お知らせ"
        backHref="/home"
        backLabel="ホーム"
      />
      <div className="px-4 pt-1 space-y-3">
        {notices.length === 0 ? (
          <EmptyState title="お知らせはありません" />
        ) : (
          notices.map((n) => (
            <NoticeCard
              key={n.id}
              notice={n}
              userId={profile.id}
              canManage={canCreateNotice}
            />
          ))
        )}
      </div>
    </>
  );
}
