import { createClient } from "@/lib/supabase/server";
import { entryClient } from "@/lib/ob-entries-db";

export async function getObEntries() {
  const client = entryClient(await createClient());
  const [entries, members, history, party] = await Promise.all([
    client.from("ob_meet_entries").select("*").eq("meet_key", "ob-2026").order("grade").order("submitted_name"),
    client.from("profiles").select("id,display_name,grade").eq("status", "active").eq("approved", true).order("display_name"),
    client.from("ob_meet_entries").select("submitted_name,profile_id").neq("meet_key", "ob-2026").not("profile_id", "is", null),
    client.from("ob_party_responses").select("id,meet_key,submitted_name,group_label,status,entry_id,revision,needs_review").eq("meet_key", "ob-2026").order("group_label").order("submitted_name"),
  ]);
  if (entries.error || members.error || history.error || party.error) throw new Error("エントリー情報を取得できませんでした");
  return { entries, members, history, party };
}
