import { createClient } from "@/lib/supabase/server";
import { entryClient } from "@/lib/ob-entries-db";
import { isAlumniEntry, matchEntryMember, type ObEntry } from "@/lib/ob-entries";
import { OB_MEET, type ObPartyResponse } from "@/lib/ob-meet";
import { combineObDuties, dutyRoleText, hasDuty } from "@/lib/ob-duty";
import { obFamilyRows, obFamilyPlacement } from "@/lib/ob-mixed-operations";

export async function getObEntries() {
  const client = entryClient(await createClient());
  const [entries, members, history, party, duties, dutyRoles, entryDuties] = await Promise.all([
    client.from("ob_meet_entries").select("*").eq("meet_key", OB_MEET.meetKey).order("grade").order("submitted_name"),
    client.from("profiles").select("id,display_name,grade").eq("status", "active").eq("approved", true).order("display_name"),
    client.from("ob_meet_entries").select("submitted_name,profile_id").neq("meet_key", OB_MEET.meetKey).not("profile_id", "is", null),
    client.from("ob_party_responses").select("id,meet_key,submitted_name,group_label,status,entry_id,revision,needs_review").eq("meet_key", OB_MEET.meetKey).order("group_label").order("submitted_name"),
    client.from("ob_meet_duties").select("meet_key,profile_id,slot_time,event_name,assignment,revision,role_ids").eq("meet_key", OB_MEET.meetKey),
    client.from("ob_duty_roles").select("*").eq("meet_key",OB_MEET.meetKey).order("name"),
    client.from("ob_entry_duties").select("*").eq("meet_key",OB_MEET.meetKey),
  ]);
  if (entries.error || members.error || history.error || party.error || duties.error || dutyRoles.error || entryDuties.error) throw new Error("エントリー情報を取得できませんでした");
  return { entries, members, history, party, duties:{...duties,data:combineObDuties(duties.data??[],entryDuties.data??[],entries.data??[])}, dutyRoles };
}

/** ホーム用: 自分に紐付いたOB戦のエントリーだけを取る（RLSでも本人の分だけ）。 */
export async function getMyObEntry(profileId: string) {
  const client = entryClient(await createClient());
  const { data, error } = await client.from("ob_meet_entries")
    .select("id,events,qualification_marks,absent").eq("meet_key", OB_MEET.meetKey).eq("profile_id", profileId).limit(1).maybeSingle();
  if (error) throw new Error("自分のエントリーを取得できませんでした");
  return data as { id: string; events: string[]; qualification_marks: Record<string, string | null>; absent: boolean } | null;
}

/** Only the viewer's own event state is sent to the home client. */
export async function getMyObParticipation(entryId: string) {
  const { getObEventOperations } = await import("./ob-operations");
  const operations = await getObEventOperations();
  const families = new Set(operations.filter(operation => operation.data.participants.some(person => person.entryId === entryId))
    .map(operation => operation.event_name.replace(/^(男子|女子)/, "")));
  // Field numbers require the whole saved order, including both divisions. Only personal summaries leave the server.
  return [...families].flatMap(family => obFamilyRows(family, [], operations)
    .filter(row => row.entryId === entryId)
    .map(row => ({ event: row.eventName, status: row.performance.status, placement: obFamilyPlacement(row) })));
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

/** 一般部員の画面用: 自分のエントリーと懇親会の回答（RLSで本人の分だけ読める）。 */
export async function getMyObEntryFull(profileId: string) {
  const client = entryClient(await createClient());
  const { data: entry, error } = await client.from("ob_meet_entries").select("*").eq("meet_key", OB_MEET.meetKey).eq("profile_id", profileId).limit(1).maybeSingle();
  if (error) throw new Error("自分のエントリーを取得できませんでした");
  const partyResult = entry
    ? await client.from("ob_party_responses").select("id,meet_key,submitted_name,group_label,status,entry_id,revision,needs_review").eq("entry_id", entry.id).maybeSingle()
    : { data: null, error: null };
  if (partyResult.error) throw new Error("懇親会の回答を取得できませんでした");
  return { entry: (entry ?? null) as ObEntry | null, party: partyResult.data as ObPartyResponse | null };
}

/** Shared program excludes party answers and identity history. */
export async function getObProgram() {
  const client = entryClient(await createClient());
  const { getObEventOperations } = await import("./ob-operations");
  const [entries, members, duties, roles, entryDuties, operations] = await Promise.all([
    client.from("ob_meet_entries").select("*").eq("meet_key", OB_MEET.meetKey),
    client.from("profiles").select("id,display_name,grade").eq("status", "active").eq("approved", true),
    client.from("ob_meet_duties").select("*").eq("meet_key", OB_MEET.meetKey),
    client.from("ob_duty_roles").select("*").eq("meet_key", OB_MEET.meetKey),
    client.from("ob_entry_duties").select("*").eq("meet_key", OB_MEET.meetKey),
    getObEventOperations(),
  ]);
  if (entries.error || members.error || duties.error || roles.error || entryDuties.error) throw new Error("プログラムを取得できませんでした");
  return { entries: entries.data ?? [], members: members.data ?? [], duties: combineObDuties(duties.data ?? [], entryDuties.data ?? [], entries.data ?? []), roles: roles.data ?? [], operations };
}

/** Home: only confirmed identity IDs are used, never a name-based assignment. */
export async function getMyObDuties(profileId: string, entryId: string | null) {
  const client = entryClient(await createClient());
  const [legacy, byEntry, roles] = await Promise.all([
    client.from("ob_meet_duties").select("*").eq("meet_key", OB_MEET.meetKey).eq("profile_id", profileId),
    entryId ? client.from("ob_entry_duties").select("*").eq("meet_key", OB_MEET.meetKey).eq("entry_id", entryId) : Promise.resolve({ data: [], error: null }),
    client.from("ob_duty_roles").select("*").eq("meet_key", OB_MEET.meetKey),
  ]);
  if (legacy.error || byEntry.error || roles.error) throw new Error("自分の補助担当を取得できませんでした");
  return combineObDuties(legacy.data ?? [], byEntry.data ?? [], entryId ? [{id:entryId,profile_id:profileId}] : [])
    .filter(hasDuty).sort((a,b) => a.slot_time.localeCompare(b.slot_time) || a.event_name.localeCompare(b.event_name, "ja"))
    .map(duty => ({time:duty.slot_time,event:duty.event_name,assignment:dutyRoleText(duty, roles.data ?? [])}));
}
