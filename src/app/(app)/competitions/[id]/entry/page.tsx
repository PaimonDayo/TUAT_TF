import { notFound } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { ObMyEntry } from "@/components/features/ObMyEntry";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getMyObEntryFull, getObProgram } from "@/lib/queries/ob-entries";
import { isObCompetition, OB_PROGRAM_PATH } from "@/lib/ob-meet";

export default async function ObEntryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const [{ id }, { from }, profile] = await Promise.all([params, searchParams, getCurrentProfile()]);
  if (!isObCompetition(id)) notFound();
  const [mine, program] = await Promise.all([getMyObEntryFull(profile.id), getObProgram()]);
  const returnHref = from === "home" ? "/home" : `${OB_PROGRAM_PATH}?view=mine`;
  const me = { id: profile.id, display_name: profile.display_name, grade: profile.grade };
  return <><SubHeader title="自分のOB戦登録" backHref={returnHref} forceBackHref /><ObMyEntry entry={mine.entry} party={mine.party ?? undefined} me={me} openEditor returnHref={returnHref} duties={program.duties.filter(duty => duty.profile_id === profile.id)} roles={program.roles} /></>;
}
