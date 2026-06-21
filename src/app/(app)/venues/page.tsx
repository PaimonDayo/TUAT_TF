import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { VenueManager } from "@/components/features/VenueManager";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getAllVenues } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";

export default async function VenuesPage() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).createSchedule) redirect("/home");

  const venues = await getAllVenues();

  return (
    <>
      <SubHeader title="練習場所" backHref="/mypage" />
      <div className="px-4 pt-2 space-y-3">
        <VenueManager initial={venues} />
      </div>
    </>
  );
}
