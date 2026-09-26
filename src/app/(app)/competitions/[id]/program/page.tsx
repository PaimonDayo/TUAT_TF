import { notFound, redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { CompetitionProgramView } from "@/components/features/CompetitionProgramView";
import { ObEntryReview } from "@/components/features/ObEntryReview";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getCompetitionById, getCompetitionProgramEntries } from "@/lib/queries";
import { getObEntries } from "@/lib/queries/ob-entries";
import { isObCompetition } from "@/lib/ob-meet";
import { permissionsOf } from "@/lib/permissions";

export default async function CompetitionProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const { edit } = await searchParams;
  const [profile, competition] = await Promise.all([
    getCurrentProfile(),
    getCompetitionById(id),
  ]);
  if (!competition) notFound();
  const canManage = permissionsOf(profile.roles).manageSystem;
  const header = <SubHeader title={`${competition.name}プログラム`} backHref={`/competitions/${competition.id}`} />;

  // OB戦のプログラムは出場登録そのもの。今回はシステムロール限定で公開している。
  if (isObCompetition(competition.id)) {
    if (!canManage) redirect(`/competitions/${competition.id}`);
    const { entries, members, history, party, duties, dutyRoles } = await getObEntries();
    return (
      <>
        {header}
        <ObEntryReview
          competition={competition}
          initial={entries.data ?? []}
          members={members.data ?? []}
          viewerId={profile.id}
          openMine={edit === "mine"}
          openIdentity={edit === "identity"}
          party={party.data ?? []}
          duties={duties.data ?? []}
          dutyRoles={dutyRoles.data ?? []}
          history={(history.data ?? []).flatMap((h) => h.profile_id ? [{ submitted_name: h.submitted_name, profile_id: h.profile_id }] : [])}
        />
      </>
    );
  }

  const entries = await getCompetitionProgramEntries(id);

  return (
    <>
      {header}
      <CompetitionProgramView
        competition={competition}
        initialEntries={entries}
        canManage={canManage}
      />
    </>
  );
}
