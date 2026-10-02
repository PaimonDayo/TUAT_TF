import { ObEntryHistory } from "@/components/features/ObEntryHistory";
import { notFound } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { CompetitionProgramView } from "@/components/features/CompetitionProgramView";
import { ObEntryReview } from "@/components/features/ObEntryReview";
import { ObMyEntry } from "@/components/features/ObMyEntry";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getCompetitionById, getCompetitionProgramEntries } from "@/lib/queries";
import { getMyObEntryFull, getObEntries } from "@/lib/queries/ob-entries";
import { canManageObMeet, canViewObHistory, isObCompetition } from "@/lib/ob-meet";
import { permissionsOf } from "@/lib/permissions";
import { getObEventOperations } from "@/lib/queries/ob-operations";
import { ObOperations } from "@/components/features/ObOperations";

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
  // OB戦はホームから開く人が多いので、戻るは必ずホームへ。
  const header = isObCompetition(competition.id)
    ? <SubHeader title={`${competition.name}プログラム`} backHref="/home" forceBackHref />
    : <SubHeader title={`${competition.name}プログラム`} backHref={`/competitions/${competition.id}`} />;

  // OB戦のプログラムは出場登録そのもの。本人とOB戦担当者が編集する。
  if (isObCompetition(competition.id)) {
    if (canManage && !canManageObMeet(profile.roles)) {
      const [roster, operations] = await Promise.all([getObEntries(), getObEventOperations()]);
      return <>{header}<div data-ob-workspace className="space-y-4 px-4 pb-8 pt-2"><ObOperations entries={roster.entries.data ?? []} members={roster.members.data ?? []} duties={roster.duties.data ?? []} roles={roster.dutyRoles.data ?? []} initial={operations} canEditDuties={false}/></div></>;
    }
    // 係（OB戦2026ロール）は全員分、それ以外の部員は自分のエントリーだけを扱う。
    if (!canManageObMeet(profile.roles)) {
      const mine = await getMyObEntryFull(profile.id);
      return (
        <>
          {header}
          <ObMyEntry entry={mine.entry} party={mine.party ?? undefined} me={{ id: profile.id, display_name: profile.display_name, grade: profile.grade }} openEditor={edit === "mine"} />
          {canViewObHistory(profile.roles) && <ObEntryHistory />}
        </>
      );
    }
    const [{ entries, members, history, party, duties, dutyRoles }, operations] = await Promise.all([getObEntries(), canManage ? getObEventOperations() : Promise.resolve(undefined)]);
    return (
      <>
        {header}
        <ObEntryReview
          competition={competition}
          operations={operations}
          initial={entries.data ?? []}
          members={members.data ?? []}
          viewerId={profile.id}
          me={{ id: profile.id, display_name: profile.display_name, grade: profile.grade }}
          openMine={edit === "mine"}
          openIdentity={edit === "identity"}
          party={party.data ?? []}
          duties={duties.data ?? []}
          dutyRoles={dutyRoles.data ?? []}
          history={(history.data ?? []).flatMap((h) => h.profile_id ? [{ submitted_name: h.submitted_name, profile_id: h.profile_id }] : [])}
        />
        {canViewObHistory(profile.roles) && <ObEntryHistory />}
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
