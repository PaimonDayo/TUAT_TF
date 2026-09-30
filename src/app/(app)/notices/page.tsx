import Link from "next/link";
import { SubHeader } from "@/components/layout/SubHeader";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getNotices, getPersonalNotifications } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { NoticesClient } from "./NoticesClient";
import type { NoticeWithReactions } from "@/types";

export default async function NoticesPage() {
  const profile = await getCurrentProfile();
  const permissions = permissionsOf(profile.roles);
  const canCreateNotice = permissions.createNotice;
  
  const [notices, notifications] = await Promise.all([
    getNotices(profile.id),
    getPersonalNotifications(profile.id),
  ]);

  return (
    <>
      <SubHeader title="お知らせ" backHref="/home" />
      {permissions.manageSystem && <Link href="/mypage/settings#practice-record-settings" prefetch={false} className="mx-4 my-3 block rounded-xl border border-separator bg-surface p-4">
        <span className="block text-body font-semibold">10月以降の記録設定について</span>
        <span className="mt-1 block text-caption text-muted">シート・入力方法・表示項目は、マイページの設定から変更できます。</span>
        <span className="mt-2 block text-caption font-semibold text-accent">記録の設定を開く →</span>
      </Link>}
      <NoticesClient
        profile={{ id: profile.id, roles: profile.roles }}
        notices={notices as NoticeWithReactions[]}
        notifications={notifications}
        canCreateNotice={canCreateNotice}
      />
    </>
  );
}
