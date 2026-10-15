import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { AdminSheetSettings } from "@/components/features/AdminSheetSettings";
import { getMemberSheetSettings } from "@/lib/queries";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";

export default async function AdminSheetSettingsPage() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) redirect("/home");
  const members = await getMemberSheetSettings();

  return <>
    <SubHeader title="スプレッドシート連携" backHref="/mypage/settings" />
    <AdminSheetSettings members={members} />
  </>;
}
