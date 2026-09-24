import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { ObEntryReview } from "@/components/features/ObEntryReview";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { permissionsOf } from "@/lib/permissions";
import { entryClient } from "@/lib/ob-entries-db";

export default async function ObEntriesPage() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) redirect("/home");
  const client = entryClient(await createClient());
  const [entries, members] = await Promise.all([
    client.from("ob_meet_entries").select("*").eq("meet_key", "ob-2026").order("grade").order("submitted_name"),
    client.from("profiles").select("id,display_name,grade").eq("status", "active").eq("approved", true).order("display_name"),
  ]);
  if (entries.error || members.error) throw new Error("エントリー情報を取得できませんでした");
  return <><SubHeader title="OB戦エントリー" backHref="/mypage" />
    <ObEntryReview initial={entries.data ?? []} members={members.data ?? []} viewerId={profile.id} />
  </>;
}
