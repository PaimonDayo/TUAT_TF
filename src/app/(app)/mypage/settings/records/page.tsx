import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { OctoberSheetSetup } from "@/components/features/OctoberSheetSetup";

export default async function RecordSettingsPage() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) notFound();
  return <OctoberSheetSetup profile={profile} />;
}
