import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { ServiceStatusPanel } from "@/components/features/ServiceStatusPanel";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";

export default async function ServiceStatusPage() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) redirect("/home");
  return <>
    <SubHeader title="サービスの状態" backHref="/mypage/settings" />
    <ServiceStatusPanel />
  </>;
}
