import { ObMeetWorkspace } from "@/components/features/ObMeetWorkspace";
import { ObPublicProgram } from "@/components/features/ObPublicProgram";
import { getObProgram } from "@/lib/queries/ob-entries";
import { ObEntryHistory } from "@/components/features/ObEntryHistory";
import { obDutyIssues } from "@/lib/ob-duty-issues";
import { notFound } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { CompetitionProgramView } from "@/components/features/CompetitionProgramView";
import { ObMyEntry } from "@/components/features/ObMyEntry";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getCompetitionById, getCompetitionProgramEntries } from "@/lib/queries";
import { getMyObEntryFull, getObEntries } from "@/lib/queries/ob-entries";
import { canManageObMeet, canViewObHistory, isObCompetition } from "@/lib/ob-meet";
import { permissionsOf } from "@/lib/permissions";
import { ObDayWorkspace } from "@/components/features/ObDayWorkspace";
import { ObMeetParticipants } from "@/components/features/ObMeetParticipants";
import { getObEventOperations } from "@/lib/queries/ob-operations";

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
  // 開いた元へ戻る。直接URLを開いた場合だけホームを使う。
  const header = isObCompetition(competition.id)
    ? <SubHeader title={competition.name} backHref="/home" />
    : <SubHeader title={`${competition.name}プログラム`} backHref={`/competitions/${competition.id}`} />;

  // OB戦のプログラムは出場登録そのもの。本人とOB戦担当者が編集する。
  if (isObCompetition(competition.id)) {
    const staff = canManageObMeet(profile.roles);
    const [mine, publicProgram, roster, operations] = await Promise.all([
      getMyObEntryFull(profile.id),
      staff || canManage ? Promise.resolve(null) : getObProgram(),
      staff || canManage ? getObEntries() : Promise.resolve(null),
      staff || canManage ? getObEventOperations() : Promise.resolve([]),
    ]);
    const program = publicProgram ?? {
      entries: roster!.entries.data ?? [], members: roster!.members.data ?? [],
      duties: roster!.duties.data ?? [], roles: roster!.dutyRoles.data ?? [], operations,
    };
    const me = { id: profile.id, display_name: profile.display_name, grade: profile.grade };
    const management = roster && staff ? <ObMeetParticipants entries={program.entries} members={roster.members.data ?? []}
      history={(roster.history.data ?? []).flatMap(h => h.profile_id ? [{ submitted_name: h.submitted_name, profile_id: h.profile_id }] : [])}
      party={roster.party.data ?? []} duties={program.duties} roles={program.roles} operations={program.operations}
      initialFilter={edit === "identity" ? "identity" : "all"}
      footer={canViewObHistory(profile.roles) ? <ObEntryHistory /> : undefined}
    /> : undefined;
    return <>{header}<ObMeetWorkspace key={edit ?? "program"}
      userId={profile.id}
      dutyIssues={obDutyIssues(program.entries,program.members,program.duties,program.roles,program.operations)}
      initialView={edit === "mine" ? "mine" : edit === "identity" && staff ? "management" : staff || canManage ? "day" : "program"}
      program={<>{(staff || canManage) && <p className="text-caption">部員に表示されるプログラムです。組分け・DNS・記録の入力は「当日運営」で行います。</p>}<ObPublicProgram {...program} /></>}
      duties={<ObPublicProgram {...program} view="duties" canEditDuties={staff} />}
      mine={<><ObMyEntry embedded entry={mine.entry} party={mine.party ?? undefined} me={me} duties={program.duties.filter(duty=>duty.profile_id===profile.id)} roles={program.roles} operations={program.operations} openEditor={edit === "mine"} />
        {!management && canViewObHistory(profile.roles) && <ObEntryHistory />}</>}
      management={management}
      day={staff || canManage ? <ObDayWorkspace entries={program.entries} members={program.members} duties={program.duties} roles={program.roles} operations={program.operations} canRegister={staff}/> : undefined}
    /></>;
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
