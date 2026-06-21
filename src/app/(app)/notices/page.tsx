import { SubHeader } from "@/components/layout/SubHeader";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getNotices, getPersonalNotifications } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { NoticesClient } from "./NoticesClient";
import type { NoticeWithReactions } from "@/types";

export default async function NoticesPage() {
  const profile = await getCurrentProfile();
  const canCreateNotice = permissionsOf(profile.roles).createNotice;
  
  const [notices, notifications] = await Promise.all([
    getNotices(profile.id),
    getPersonalNotifications(profile.id),
  ]);

  return (
    <>
      <SubHeader title="お知らせ" backHref="/home" />
      <NoticesClient
        profile={{ id: profile.id, roles: profile.roles }}
        notices={notices as NoticeWithReactions[]}
        notifications={notifications}
        canCreateNotice={canCreateNotice}
      />
    </>
  );
}
