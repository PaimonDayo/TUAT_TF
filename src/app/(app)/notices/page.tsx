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
      {permissions.manageSystem && <Link href="/settings/sheet-setup" className="mx-4 my-3 block rounded-xl border border-separator bg-surface p-4 text-body font-semibold">10月以降のシート・入力設定<span className="mt-1 block text-caption font-normal text-muted">自分のシート、入力方法、フォーム・表示項目を確認・変更</span></Link>}
      <NoticesClient
        profile={{ id: profile.id, roles: profile.roles }}
        notices={notices as NoticeWithReactions[]}
        notifications={notifications}
        canCreateNotice={canCreateNotice}
      />
    </>
  );
}
