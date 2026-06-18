import { Header } from "@/components/layout/Header";
import { NoticeCard } from "@/components/cards/NoticeCard";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getNotices } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { NoticeComposer } from "@/components/post/NoticeForm";
import type { Notice } from "@/types";

export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string }>;
}) {
  const { compose } = await searchParams;
  const profile = await getCurrentProfile();
  const canCreateNotice = permissionsOf(profile.roles).createNotice;
  const notices = (await getNotices()) as Notice[];

  return (
    <>
      <Header
        title="お知らせ"
        large
        right={canCreateNotice ? <NoticeComposer autoOpen={compose === "1"} /> : undefined}
      />
      <div className="px-4 pt-1 space-y-3">
        {notices.length === 0 ? (
          <p className="text-caption text-center py-16">お知らせはありません。</p>
        ) : (
          notices.map((n) => <NoticeCard key={n.id} notice={n} canManage={canCreateNotice} />)
        )}
      </div>
    </>
  );
}
