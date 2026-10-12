import { notFound } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { CompetitionMeetWorkspace } from "@/components/features/CompetitionMeetWorkspace";
import { getCompetitionById } from "@/lib/queries";
import { getCompetitionMeet, getCompetitionMeetBackend } from "@/lib/queries/competition-meet";
import { getCurrentProfile, isMemberPreviewActive } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import type { CompetitionMeet } from "@/lib/competition-meet";

export default async function MeetManagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ section?: string; edit?: string }> }) {
  const { id } = await params, requested = await searchParams;
  const [competition, profile, preview, stored] = await Promise.all([getCompetitionById(id),getCurrentProfile(),isMemberPreviewActive(),getCompetitionMeet(id)]);
  if (!competition) notFound();
  const system = permissionsOf(profile.roles).manageSystem;
  const meet: CompetitionMeet = stored ?? {competitionId:id,name:competition.name,meetKey:id,backend:await getCompetitionMeetBackend(),events:[],participants:[],appearances:[],duties:[],roles:[],party:[],members:[],permissions:{manage:system,groups:system,record:false,configure:system}};
  const safe = preview ? {...meet,permissions:{manage:false,groups:false,record:false,register:false,configure:false},members:[],party:[]} : meet;
  const section = requested.section === "participants" || requested.edit === "identity" ? "participants" : requested.section === "duties" ? "duties" : "events";
  return <><SubHeader title={competition.name} backHref={`/competitions/${id}`} /><CompetitionMeetWorkspace meet={safe} me={{id:profile.id,display_name:profile.display_name,grade:profile.grade}} initialSection={section} initialEdit={requested.edit === "mine" || requested.section === "mine"} /></>;
}
