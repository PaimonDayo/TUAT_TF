import { createClient } from "@/lib/supabase/server";
import { entryClient } from "@/lib/ob-entries-db";
import { isAlumniEntry, matchEntryMember, type ObEntry } from "@/lib/ob-entries";

export async function getObEntries() {
  const client = entryClient(await createClient());
  const [entries, members, history, party, duties, dutyRoles] = await Promise.all([
    client.from("ob_meet_entries").select("*").eq("meet_key", "ob-2026").order("grade").order("submitted_name"),
    client.from("profiles").select("id,display_name,grade").eq("status", "active").eq("approved", true).order("display_name"),
    client.from("ob_meet_entries").select("submitted_name,profile_id").neq("meet_key", "ob-2026").not("profile_id", "is", null),
    client.from("ob_party_responses").select("id,meet_key,submitted_name,group_label,status,entry_id,revision,needs_review").eq("meet_key", "ob-2026").order("group_label").order("submitted_name"),
    client.from("ob_meet_duties").select("meet_key,profile_id,slot_time,event_name,assignment,revision,role_ids").eq("meet_key", "ob-2026"),
    client.from("ob_duty_roles").select("*").eq("meet_key","ob-2026").order("name"),
  ]);
  if (entries.error || members.error || history.error || party.error || duties.error || dutyRoles.error) throw new Error("エントリー情報を取得できませんでした");
  return { entries, members, history, party, duties, dutyRoles };
}

/** ホーム用: 自分に紐付いたOB戦のエントリーだけを取る（システムロール限定。RLSでも同じ範囲）。 */
export async function getMyObEntry(profileId: string) {
  const client = entryClient(await createClient());
  const { data, error } = await client.from("ob_meet_entries")
    .select("id,events,qualification_marks").eq("meet_key", "ob-2026").eq("profile_id", profileId).limit(1).maybeSingle();
  if (error) return null;
  return data as { id: string; events: string[]; qualification_marks: Record<string, string | null> } | null;
}

/** ホーム用: まだ誰にも紐付いていない回答のうち、氏名照合で自分が候補に挙がるもの（自動確定はしない）。 */
export async function getMyObEntryCandidates(profileId: string) {
  const { entries, members, history } = await getObEntries();
  const all = members.data ?? [];
  const confirmed = (history.data ?? []).flatMap((h) => h.profile_id ? [{ submitted_name: h.submitted_name, profile_id: h.profile_id }] : []);
  return (entries.data ?? []).filter((e: ObEntry) => !e.profile_id && !isAlumniEntry(e))
    .flatMap((e: ObEntry) => {
      const match = matchEntryMember(e, all, confirmed);
      return match.candidates.some((c) => c.id === profileId)
        ? [{ id: e.id, revision: e.revision, submitted_name: e.submitted_name, grade: e.grade, events: e.events, sure: match.status === "exact" || match.status === "previous" }]
        : [];
    });
}
