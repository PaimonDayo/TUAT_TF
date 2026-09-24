import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { ObEntryReview } from "@/components/features/ObEntryReview";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { getObEntries } from "@/lib/queries/ob-entries";

export default async function ObEntriesPage() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) redirect("/home");
  const { entries, members, history, party } = await getObEntries();
  return <><SubHeader title="OB戦エントリー" backHref="/mypage" />
    <ObEntryReview initial={entries.data ?? []} members={members.data ?? []} viewerId={profile.id} party={party.data ?? []}
      history={(history.data ?? []).flatMap((h) => h.profile_id ? [{ submitted_name: h.submitted_name, profile_id: h.profile_id }] : [])} />
  </>;
}
