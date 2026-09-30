import { getCurrentProfile } from "@/lib/supabase/auth";
import { OctoberSheetSetup } from "@/components/features/OctoberSheetSetup";

export default async function RecordSettingsPage() {
  const profile = await getCurrentProfile();
  return <OctoberSheetSetup profile={profile} />;
}
