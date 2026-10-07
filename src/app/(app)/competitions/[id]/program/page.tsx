import { ObMeetWorkspace } from "@/components/features/ObMeetWorkspace";
import { ObPublicProgram } from "@/components/features/ObPublicProgram";
import { getObProgram } from "@/lib/queries/ob-entries";
import { ObEntryHistory } from "@/components/features/ObEntryHistory";
import { obDutyIssues } from "@/lib/ob-duty-issues";
import { notFound } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { CompetitionProgramView } from "@/components/features/CompetitionProgramView";
import { ObMyEntry } from "@/components/features/ObMyEntry";
import { getCurrentProfile, isMemberPreviewActive } from "@/lib/supabase/auth";
import { getCompetitionById, getCompetitionProgramEntries } from "@/lib/queries";
import { getMyObEntryFull, getObEntries } from "@/lib/queries/ob-entries";
import { canManageObMeet, canRecordObMeet, canViewObHistory, isObCompetition, OB_PROGRAM_PATH } from "@/lib/ob-meet";
import { obWorkspaceDestination } from "@/lib/ob-meet-navigation";
import { permissionsOf } from "@/lib/permissions";
import { ObDayWorkspace } from "@/components/features/ObDayWorkspace";
import { ObMeetParticipants } from "@/components/features/ObMeetParticipants";
import { getObEventOperations } from "@/lib/queries/ob-operations";

export default async function CompetitionProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; view?: string; section?: string }>;
}) {
  const { id } = await params;
  const requested = await searchParams;
  const { edit } = requested;
  const [profile, competition, preview] = await Promise.all([
    getCurrentProfile(),
    getCompetitionById(id),
    isMemberPreviewActive(),
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
    const canOperate = canRecordObMeet(profile) && !preview;
    const { view, section } = obWorkspaceDestination(requested, canOperate, staff);
    const managementView = view === "operations" && section === "participants" && staff;
    const [mine, publicProgram, roster, operations] = await Promise.all([
      section === "mine" ? getMyObEntryFull(profile.id) : Promise.resolve(null),
      managementView ? Promise.resolve(null) : getObProgram(),
      managementView ? getObEntries() : Promise.resolve(null),
      managementView ? getObEventOperations() : Promise.resolve([]),
    ]);
    const program = publicProgram ?? {
      entries: roster!.entries.data ?? [], members: roster!.members.data ?? [],
      duties: roster!.duties.data ?? [], roles: roster!.dutyRoles.data ?? [], operations,
    };
    const me = { id: profile.id, display_name: profile.display_name, grade: profile.grade };
    const management = roster ? <ObMeetParticipants entries={program.entries} members={roster.members.data ?? []}
      history={(roster.history.data ?? []).flatMap(h => h.profile_id ? [{ submitted_name: h.submitted_name, profile_id: h.profile_id }] : [])}
      party={roster.party.data ?? []} duties={program.duties} roles={program.roles} operations={program.operations}
      initialFilter={edit === "identity" ? "identity" : "all"}
      footer={canViewObHistory(profile.roles) ? <ObEntryHistory /> : undefined}
    /> : undefined;
    return <>{header}<ObMeetWorkspace key={`${view}:${section}:${edit ?? ""}`}
      userId={profile.id}
      view={view} section={section} canOperate={canOperate} staff={staff}
      dutyIssues={obDutyIssues(program.entries,program.members,program.duties,program.roles,program.operations)}
    >{section === "mine" ? <>
        <ObMyEntry embedded entry={mine!.entry} party={mine!.party ?? undefined} me={me} duties={program.duties.filter(duty=>duty.profile_id===profile.id)} roles={program.roles} operations={program.operations} openEditor={edit === "mine"} returnHref={edit === "mine" ? `${OB_PROGRAM_PATH}?view=operations&section=mine` : undefined} />
        <h2 className="text-headline">全体のプログラム</h2><ObPublicProgram {...program} />
      </> : section === "participants" ? management : section === "duties" ? <ObPublicProgram {...program} view="duties" canEditDuties={staff} />
      : section === "program" ? <ObPublicProgram {...program} />
      : <ObDayWorkspace entries={program.entries} members={program.members} duties={program.duties} roles={program.roles} operations={program.operations} canRegister={staff} canEditGroups={staff || canManage}/>}
    </ObMeetWorkspace></>;
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
