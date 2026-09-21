import { notFound } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { CompetitionProgramView } from "@/components/features/CompetitionProgramView";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getCompetitionById, getCompetitionProgramEntries } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";

export default async function CompetitionProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const [profile, competition] = await Promise.all([
    getCurrentProfile(),
    getCompetitionById(id),
  ]);
  if (!competition) notFound();

  const entries = await getCompetitionProgramEntries(id);

  return (
    <>
      <SubHeader title={`${competition.name}プログラム`} backHref={`/competitions/${competition.id}`} />
      <CompetitionProgramView
        competition={competition}
        initialEntries={entries}
        initialView={(await searchParams).view === "results" ? "results" : "program"}
        canManage={permissionsOf(profile.roles).manageSystem}
      />
    </>
  );
}
