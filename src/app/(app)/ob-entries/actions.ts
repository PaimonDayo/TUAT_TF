"use server";

import { revalidatePath } from "next/cache";
import { scheduleObResultsPublish } from "@/lib/ob-results-notify";
import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds, isMemberPreviewActive } from "@/lib/supabase/auth";
import { entryClient } from "@/lib/ob-entries-db";
import { validDutyEdit, validDutyPeopleEdit, type DutyEdit, type DutyPeopleEdit } from "@/lib/ob-duty";
import type { Json } from "@/types/database";
import { OB_PROGRAM_PATH, canManageObMeet, canViewObHistory, validPartyEdit, type PartyEdit } from "@/lib/ob-meet";
import { validEntryEdit, type EntryEdit } from "@/lib/ob-entry-edit";
/** 旧URL（転送のみ）と、大会ページ配下のプログラムの両方を更新する。 */
function refreshObPages() { scheduleObResultsPublish(); revalidatePath("/ob-entries"); revalidatePath(OB_PROGRAM_PATH); revalidatePath("/home"); }

/** 係（OB戦2026ロール）だけに返す。allowSelf なら一般部員にも返す（本人の分かどうかはDBが確認する）。 */
async function editClient(allowSelf = false) {
  const client = entryClient(await createClient());
  const { data: { user } } = await client.auth.getUser();
  if (!user || await isMemberPreviewActive()) return null;
  if (allowSelf) return client;
  const roles = await fetchRolesByProfileIds(await createClient(), [user.id]);
  if (!canManageObMeet(roles.get(user.id))) return null;
  return client;
}

export async function saveEntry(input: EntryEdit, party?: PartyEdit, confirmDuties = false): Promise<{ ok: boolean; message?: string; uncertain?: boolean; dutyConflicts?: {time:string;event:string;assignment:string}[] }> {
  if (typeof confirmDuties !== "boolean") return {ok:false,message:"補助担当の確認内容を確認してください"};
  if ((party !== undefined && !validPartyEdit(party)) || !validEntryEdit(input, !!party && party.status !== "未回答")) return { ok: false, message: "種目と資格記録を確認してください（記録は1000文字以内）" };
  const client = await editClient(!input.details);
  if (!client) return { ok: false, message: "権限がありません" };
  const args = { p_entry_id: input.entryId, p_profile_id: input.profileId, p_revision: input.revision, p_events: input.events, p_marks: input.marks };
  const registration = { ...args, p_party_id: party?.id ?? null, p_party_revision: party?.revision ?? null, p_party_status: party?.status ?? null, p_confirm_duties: confirmDuties };
  const result = input.details
    ? await client.rpc("save_ob_registration_details_checked", { ...registration, p_entry_id: input.entryId!, p_revision: input.revision!, p_name: input.details.name.trim(), p_grade: input.details.grade })
    : await client.rpc("save_ob_registration_checked", registration);
  if (result.error) {
    if (result.error.message.includes("entry_duty_conflict")) {
      try {
        const dutyConflicts: unknown = JSON.parse(result.error.details);
        if (Array.isArray(dutyConflicts) && dutyConflicts.every(row => row && typeof row.time === "string" && typeof row.event === "string" && typeof row.assignment === "string")) return {ok:false,message:"出場と補助担当が重複します。担当を確認してください",dutyConflicts};
      } catch { /* Keep the form when the returned details cannot be read. */ }
      return {ok:false,message:"出場と補助担当が重複します。補助員表で担当を確認してください"};
    }
    const message = result.error.code === "23505" ? input.details ? "同じ氏名の参加者・回答が登録されています。氏名を確認してください" : "同じ名前の回答がすでにあります。フォームで回答済みなら「自分の回答を呼び出す」を押してください"
      : result.error.message.includes("entry_conflict") ? "他の操作で更新されています。画面を更新してからやり直してください"
      : result.error.message.includes("party_identity_required") ? "懇親会の回答と選択した部員が一致しません。本人照合を確認してください"
      : result.error.message.includes("entry_division_") ? "登録済みの男女区分と種目が一致しません。画面を更新して確認してください"
      : result.error.message.includes("entry_forbidden") ? "自分のエントリーだけ登録・編集できます"
      : result.error.message.includes("entry_member_missing") ? "在籍中で氏名・学年が登録された部員を選んでください"
      : result.error.message.includes("entry_duplicate") ? "同じ氏名の参加者が登録されています。氏名を確認してください" : "保存できませんでした";
    const uncertain = !!input.details && (!result.error.code || !/^[A-Z0-9]{5}$/.test(result.error.code));
    return { ok: false, message, ...(uncertain ? { uncertain: true } : {}) };
  }
  const saved = result.data;
  if (!saved || typeof saved !== "object" || Array.isArray(saved) || typeof saved.entryId !== "string" || !/^[0-9a-f-]{36}$/i.test(saved.entryId) || !Array.isArray(saved.conflicts)
    || input.details && (saved.entryId !== input.entryId || !saved.conflicts.every(row => row && typeof row === "object" && !Array.isArray(row) && typeof row.time === "string" && typeof row.event === "string" && typeof row.assignment === "string")
      || !entryDetailsSaved(saved, input, party))) return {ok:false,...(input.details ? {uncertain:true} : {}),message:"保存結果を確認できませんでした。入力は残っています。結果を確認してください"};
  refreshObPages();
  return { ok: true, dutyConflicts: saved.conflicts as {time:string;event:string;assignment:string}[] };
}

export async function saveDutyPeople(input: DutyPeopleEdit): Promise<{ok:boolean;message?:string}> {
  if (!validDutyPeopleEdit(input)) return {ok:false,message:"担当者の選択を確認してください"};
  const client = await editClient();
  if (!client) return {ok:false,message:"権限がありません"};
  const result = await client.rpc("save_ob_role_people", {p_role_id:input.roleId,p_revision:input.revision,p_expected:input.expected as unknown as Json,p_people:input.people});
  if (result.error) return {ok:false,message:dutyRoleError(result.error.message)};
  if (result.data !== input.roleId) return {ok:false,message:"保存結果を確認できませんでした。選択を残しています。画面を開き直して確認してください"};
  refreshObPages(); return {ok:true};
}

export async function confirmEntryMember(entryId: string, profileId: string | null, revision: number): Promise<{ ok: boolean; message?: string }> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(entryId) || (profileId !== null && !uuid.test(profileId)) || !Number.isSafeInteger(revision) || revision < 0) return { ok: false, message: "入力内容を確認してください" };
  const client = entryClient(await createClient());
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false, message: "ログインしてください" };
  const roles = await fetchRolesByProfileIds(await createClient(), [user.id]);
  if (!canManageObMeet(roles.get(user.id)) || await isMemberPreviewActive()) return { ok: false, message: "権限がありません" };
  if (profileId) {
    const member = await client.from("profiles").select("id").eq("id", profileId).eq("status", "active").eq("approved", true).maybeSingle();
    if (member.error || !member.data) return { ok: false, message: "在籍中の部員を選んでください" };
  }
  const saved = await client.from("ob_meet_entries").update({ profile_id: profileId, revision: revision + 1 })
    .eq("id", entryId).eq("meet_key", "ob-2026").eq("revision", revision).select("id").maybeSingle();
  if (saved.error?.code === "23505") return { ok: false, message: "この部員は別のエントリーに紐付いています" };
  if (saved.error?.message.includes("entry_duty_link_conflict")) return {ok:false,message:"同時刻の補助担当が重複しています。先に担当を確認・解除してください"};
  if (saved.error) return { ok: false, message: "保存できませんでした" };
  if (!saved.data) return { ok: false, message: "他の操作で更新されています。画面を更新してください" };
  refreshObPages();
  return { ok: true };
}

export async function saveParty(input: PartyEdit): Promise<{ ok: boolean; message?: string }> {
  if (!validPartyEdit(input) || !input.id || input.revision === null) return {ok:false,message:"出欠を確認してください"};
  const client = await editClient();
  if (!client) return {ok:false,message:"権限がありません"};
  const result = await client.rpc("save_ob_party", {p_id:input.id,p_revision:input.revision,p_status:input.status});
  if (result.error) return {ok:false,message:result.error.message.includes("entry_conflict") ? "他の操作で更新されています。画面を更新してください" : "保存できませんでした。本人が確認できている回答か確認してください"};
  refreshObPages();
  return {ok:true};
}

export async function saveDuty(input: DutyEdit): Promise<{ ok: boolean; message?: string; revision?: number }> {
  if (!validDutyEdit(input)) return {ok:false,message:"部員・時間帯・担当内容を確認してください（200文字以内）"};
  const client=await editClient();
  if (!client) return {ok:false,message:"権限がありません"};
  const result=await client.rpc("save_ob_duty",{p_profile_id:input.profileId,p_slot_time:input.slotTime,p_event_name:input.eventName,p_assignment:input.assignment,p_revision:input.revision});
  if(result.error) return {ok:false,message:result.error.message.includes("entry_competing") ? "この時間帯に出場する部員は補助員に登録できません" : result.error.message.includes("entry_conflict") ? "他の操作で更新されています。画面を更新してからやり直してください" : "保存できませんでした。在籍中の部員か確認してください"};
  refreshObPages();return {ok:true,revision:result.data};
}

export async function saveDutyRoles(input: import("@/lib/ob-duty").DutyRolesEdit): Promise<{ok:boolean;message?:string}> {
  const {validDutyRolesEdit}=await import("@/lib/ob-duty");
  if(!validDutyRolesEdit(input))return {ok:false,message:"役職を確認してください"};
  const client=await editClient();if(!client)return {ok:false,message:"権限がありません"};
  const args={p_slot_time:input.slotTime,p_event_name:input.eventName,p_role_ids:input.roleIds,p_revision:input.revision};
  const result=input.entryId?await client.rpc("save_ob_entry_duty_roles",{...args,p_entry_id:input.entryId}):await client.rpc("save_ob_duty_roles",{...args,p_profile_id:input.profileId});
  if(result.error)return {ok:false,message:dutyRoleError(result.error.message)};
  if(!Number.isSafeInteger(result.data)||result.data<0)return {ok:false,message:"保存を確認できませんでした。画面を開き直して確認してください"};
  refreshObPages();return {ok:true};
}
export async function saveDutyRole(input: import("@/lib/ob-duty").DutyRoleEdit): Promise<{ok:boolean;message?:string}> {
  const {validDutyRoleEdit}=await import("@/lib/ob-duty");
  if(!validDutyRoleEdit(input))return {ok:false,message:"役職名・略称・必要人数（0〜99人）を確認してください"};
  const client=await editClient();if(!client)return {ok:false,message:"権限がありません"};
  const result=await client.rpc("save_ob_duty_role",{p_id:input.id,p_slot_time:input.slotTime,p_event_name:input.eventName,p_name:input.name.trim(),p_abbreviation:input.abbreviation.trim(),p_required_count:input.requiredCount,p_revision:input.revision});
  if(result.error)return {ok:false,message:dutyRoleError(result.error.message)};
  refreshObPages();return {ok:true};
}
function dutyRoleError(message:string) {
  if(message.includes("role_assigned"))return "担当者がいる役職は削除できません。「人を編集」で担当を解除してから削除してください";
  if(message.includes("entry_duty_busy"))return "同時刻に別種目の補助担当があります。画面を更新して確認してください";
  if(message.includes("entry_helper_ineligible"))return "現役の参加回答を選んでください。OB・OGは補助員の対象外です";
  if(message.includes("role_full"))return "必要人数に達した役職があります。画面を更新して確認してください";
  if(message.includes("role_below_assigned"))return "割当済みの人数より少なくできません。先に担当を解除してください";
  if(message.includes("role_duplicate"))return "同じ名前の役職が登録されています";
  if(message.includes("entry_competing"))return "この時間帯に出場するため補助員に登録できません";
  if(message.includes("entry_conflict"))return "他の操作で更新されています。画面を更新してください";
  if(message.includes("role_names_too_long"))return "選択した役職名が長すぎます。役職名を短くしてください";
  return "保存できませんでした。入力内容を確認してください";
}

export async function deleteDutyRole(input: import("@/lib/ob-duty").DutyRoleDelete): Promise<{ok:boolean;message?:string}> {
  const {validDutyRoleDelete}=await import("@/lib/ob-duty");
  if(!validDutyRoleDelete(input))return {ok:false,message:"役職を確認してください"};
  const client=await editClient();if(!client)return {ok:false,message:"権限がありません"};
  const result=await client.rpc("delete_ob_duty_role",{p_id:input.id,p_slot_time:input.slotTime,p_event_name:input.eventName,p_revision:input.revision});
  if(result.error)return {ok:false,message:result.error.message.includes("role_assigned")||result.error.message.includes("entry_conflict")?dutyRoleError(result.error.message):"削除できませんでした。画面を更新してからやり直してください"};
  if(result.data!==input.id)return {ok:false,message:"削除を確認できませんでした。画面を更新してください"};
  refreshObPages();return {ok:true};
}

/** 紐付け前の自分の回答を、アプリの名前と学年で呼び出す（照合の条件はDBの claim_ob_entry）。 */
export async function claimMyEntry(): Promise<{ ok: boolean; message?: string }> {
  const client = await editClient(true);
  if (!client) return { ok: false, message: "権限がありません" };
  const result = await client.rpc("claim_ob_entry", {});
  if (result.error) {
    const m = result.error.message;
    return { ok: false, message: m.includes("claim_not_found") ? "アプリの名前・学年と同じ回答が見つかりません。フォームで別の名前を使った場合は係に本人照合を依頼してください"
      : m.includes("claim_ambiguous") ? "同じ名前の回答が複数あります。係に本人照合を依頼してください"
      : result.error.code === "23505" ? "すでに自分のエントリーがあります" : "呼び出せませんでした" };
  }
  refreshObPages();
  return { ok: true };
}


export async function getObEntryHistory(cursor?: { at: string; id: string }): Promise<
  { ok: true; items: import("@/lib/ob-entry-history").ObHistoryItem[]; nextCursor: { at: string; id: string } | null } | { ok: false; message: string }
> {
  const denied = { ok: false as const, message: "履歴を取得できませんでした" };
  if (cursor && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id) || !/^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$/.test(cursor.at) || !Number.isFinite(Date.parse(cursor.at)))) return denied;
  const base = await createClient();
  const { data: { user } } = await base.auth.getUser();
  if (!user || await isMemberPreviewActive()) return denied;
  const roles = await fetchRolesByProfileIds(base, [user.id]);
  if (!canViewObHistory(roles.get(user.id))) return { ok: false, message: "OB戦担当・管理者だけが変更履歴を閲覧できます" };
  const client = entryClient(base);
  let entryQuery = client.from("ob_entry_changes").select("id,actor_id,changed_at,before_data,after_data")
    .eq("after_data->>meet_key", "ob-2026").order("changed_at", { ascending: false }).order("id", { ascending: false }).limit(31);
  let operationQuery = client.from("ob_operation_changes").select("id,meet_key,event_name,actor_id,changed_at,before_data,after_data")
    .eq("meet_key", "ob-2026").order("changed_at", { ascending: false }).order("id", { ascending: false }).limit(31);
  if (cursor) {
    const filter = `changed_at.lt.${cursor.at},and(changed_at.eq.${cursor.at},id.lt.${cursor.id})`;
    entryQuery = entryQuery.or(filter); operationQuery = operationQuery.or(filter);
  }
  const [entryResult, operationResult] = await Promise.all([entryQuery, operationQuery]);
  if (entryResult.error || operationResult.error || !entryResult.data || !operationResult.data) return denied;
  const { describeObChange, describeObOperationChange, historyProfileIds, historyEntryIds, compareObHistoryPosition } = await import("@/lib/ob-entry-history");
  const combined = [
    ...entryResult.data.map(row => ({ kind: "entry" as const, row })),
    ...operationResult.data.map(row => ({ kind: "operation" as const, row })),
  ].sort((a, b) => compareObHistoryPosition(a.row, b.row));
  const rows = combined.slice(0, 30);
  const ids = historyProfileIds(rows.map(item => item.row));
  const entryIds = historyEntryIds(rows.flatMap(item => item.kind === "operation" ? [item.row] : []));
  const [people, entries] = await Promise.all([
    ids.length ? base.from("profiles").select("id,display_name").in("id", ids) : Promise.resolve({ data: [], error: null }),
    entryIds.length ? client.from("ob_meet_entries").select("id,submitted_name").eq("meet_key", "ob-2026").in("id", entryIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (people.error || entries.error || !people.data || !entries.data) return denied;
  const names = new Map(people.data.map(person => [person.id, person.display_name]));
  const entryNames = new Map(entries.data.map(entry => [entry.id, entry.submitted_name]));
  const last = rows.at(-1)?.row;
  return { ok: true, items: rows.map(item => item.kind === "entry" ? describeObChange(item.row, names) : describeObOperationChange(item.row, names, entryNames)), nextCursor: combined.length > 30 && last ? { at: last.changed_at, id: last.id } : null };
}

function entryDetailsSaved(value: unknown, input: EntryEdit, party?: PartyEdit): boolean {
  if (!input.details || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as { entry?: Record<string, unknown>; party?: Record<string, unknown> | null };
  const saved = snapshot.entry;
  if (!Object.hasOwn(snapshot, "party") || snapshot.party !== null && (!snapshot.party || typeof snapshot.party !== "object" || Array.isArray(snapshot.party))) return false;
  if (!saved || typeof saved !== "object" || Array.isArray(saved) || saved.id !== input.entryId || !Number.isSafeInteger(saved.revision) || (saved.revision as number) <= input.revision!
    || saved.submitted_name !== input.details.name.trim() || saved.grade !== input.details.grade || !Array.isArray(saved.events)
    || saved.events.length !== input.events.length || new Set(saved.events).size !== input.events.length || !saved.events.every(event => typeof event === "string" && input.events.includes(event))) return false;
  const marks = saved.qualification_marks;
  if (!marks || typeof marks !== "object" || Array.isArray(marks)) return false;
  const expected = Object.entries(input.marks).sort(([a], [b]) => a.localeCompare(b));
  if (JSON.stringify(Object.entries(marks).sort(([a], [b]) => a.localeCompare(b))) !== JSON.stringify(expected)) return false;
  if (!party) return true;
  if (snapshot.party === null) return party.id === null && party.revision === null && party.status === "未回答";
  return (!party.id || snapshot.party.id === party.id)
    && typeof snapshot.party.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshot.party.id)
    && snapshot.party.entry_id === input.entryId && snapshot.party.status === party.status
    && Number.isSafeInteger(snapshot.party.revision) && (snapshot.party.revision as number) >= (party.revision ?? 0);
}

/** Confirm only the frozen metadata/registration attempt after a lost response. */
export async function checkEntryDetails(input: EntryEdit, party?: PartyEdit): Promise<{ok:boolean;message?:string}> {
  if (!input?.details || !validEntryEdit(input, !!party && party.status !== "未回答") || party !== undefined && !validPartyEdit(party)) return {ok:false,message:"確認する保存内容を確認してください"};
  try {
    const client = await editClient();
    if (!client) return {ok:false,message:"大会担当者の権限を確認してください。入力は残っています"};
    const result = await client.rpc("get_ob_registration_details_snapshot", {p_entry_id:input.entryId!});
    if (result.error || !entryDetailsSaved(result.data, input, party)) return {ok:false,message:"保存結果を確認できませんでした。入力は残っています。もう一度結果を確認してください"};
    refreshObPages();
    return {ok:true};
  } catch { return {ok:false,message:"保存結果を取得できませんでした。入力は残っています。接続後にもう一度確認してください"}; }
}

export async function createGuestEntry(input: import("@/lib/ob-entry-edit").GuestEntryEdit): Promise<{ok:boolean;message?:string}> {
  const { validGuestEntry } = await import("@/lib/ob-entry-edit");
  if (!validGuestEntry(input)) return {ok:false,message:"氏名・学年・種目・資格記録を確認してください"};
  const client = await editClient();
  if (!client) return {ok:false,message:"権限がありません"};
  const result = await client.rpc("create_ob_guest_registration", {p_name:input.name.trim(),p_grade:input.grade,p_events:input.events,p_marks:input.marks,p_party_status:input.partyStatus,p_party_id:input.partyId??null,p_party_revision:input.partyRevision??null});
  if (result.error) return {ok:false,message:result.error.code === "23505" ? "同じ名前の回答があります。エントリー管理・懇親会の回答を確認してください" : "登録できませんでした。入力内容を確認してください"};
  if (!result.data) return {ok:false,message:"登録を確認できませんでした。画面を更新してください"};
  refreshObPages(); return {ok:true};
}
export async function deleteEntry(input: {entryId:string;revision:number}): Promise<{ok:boolean;message?:string}> {
  const { validEntryDelete } = await import("@/lib/ob-entry-edit");
  if (!validEntryDelete(input)) return {ok:false,message:"エントリーを確認してください"};
  const client = await editClient();
  if (!client) return {ok:false,message:"権限がありません"};
  const result = await client.rpc("delete_ob_registration", {p_entry_id:input.entryId,p_revision:input.revision});
  if (result.error) return {ok:false,message:result.error.message.includes("entry_has_duties") ? "補助担当があります。先に担当を解除してください" : result.error.message.includes("entry_has_operations") ? "組み分け・競技記録に登録されています。削除せず、エントリー編集で種目を取り消してください" : "削除できませんでした。他の操作で更新されていないか、画面を更新して確認してください"};
  if (result.data !== input.entryId) return {ok:false,message:"削除を確認できませんでした。画面を更新してください"};
  refreshObPages(); return {ok:true};
}
