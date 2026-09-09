import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { CompetitionEventManager } from "@/components/features/CompetitionEventManager";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getCompetitionEvents, getUnregisteredEventNames } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import type { CompetitionEvent } from "@/lib/competition-goals";

export default async function EventsPage() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) redirect("/home");

  const [events, unregistered] = await Promise.all([
    getCompetitionEvents(),
    getUnregisteredEventNames(),
  ]);

  return (
    <>
      <SubHeader title="種目" backHref="/mypage" />
      <div className="space-y-3 px-4 pt-2">
        <CompetitionEventManager
          initial={events as CompetitionEvent[]}
          unregistered={unregistered}
        />
      </div>
    </>
  );
}
