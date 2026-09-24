import { createClient } from "@/lib/supabase/server";
import { entryClient } from "@/lib/ob-entries-db";

export async function getObEntries() {
  const client = entryClient(await createClient());
  const [entries, members, history] = await Promise.all([
    client.from("ob_meet_entries").select("*").eq("meet_key", "ob-2026").order("grade").order("submitted_name"),
    client.from("profiles").select("id,display_name,grade").eq("status", "active").eq("approved", true).order("display_name"),
    client.from("ob_meet_entries").select("submitted_name,profile_id").neq("meet_key", "ob-2026").not("profile_id", "is", null),
  ]);
  if (entries.error || members.error || history.error) throw new Error("エントリー情報を取得できませんでした");
  return { entries, members, history };
}
