import { notFound } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { CompetitionGoalsView } from "@/components/features/CompetitionGoalsView";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getCompetitionById, getCompetitionGoals } from "@/lib/queries";
import type { CompetitionEvent } from "@/lib/competition-goals";

export default async function CompetitionGoalsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, competition] = await Promise.all([
    getCurrentProfile(),
    getCompetitionById(id),
  ]);
  if (!competition) notFound();

  const { goals, events, competitions, personalBests } =
    await getCompetitionGoals(id);

  return (
    <>
      <SubHeader
        title={`${competition.name}の目標`}
        backHref={`/competitions/${competition.id}`}
      />
      <CompetitionGoalsView
        competition={competition}
        competitions={competitions}
        initialGoals={goals}
        events={events as CompetitionEvent[]}
        personalBests={personalBests}
        userId={profile.id}
        displayName={profile.display_name}
        viewerBlocks={profile.blocks}
      />
    </>
  );
}
