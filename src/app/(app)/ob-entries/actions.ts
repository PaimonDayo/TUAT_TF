"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds, isMemberPreviewActive } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { entryClient } from "@/lib/ob-entries-db";
import { validDutyEdit, type DutyEdit } from "@/lib/ob-duty";
import { OB_PROGRAM_PATH, validPartyEdit, type PartyEdit } from "@/lib/ob-meet";
import { validEntryEdit, type EntryEdit } from "@/lib/ob-entry-edit";
/** 旧URL（転送のみ）と、大会ページ配下のプログラムの両方を更新する。 */
function refreshObPages() { revalidatePath("/ob-entries"); revalidatePath(OB_PROGRAM_PATH); }

async function editClient() {
  const client = entryClient(await createClient());
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const roles = await fetchRolesByProfileIds(await createClient(), [user.id]);
  if (!permissionsOf(roles.get(user.id)).manageSystem || await isMemberPreviewActive()) return null;
  return client;
}

export async function saveEntry(input: EntryEdit, party?: PartyEdit): Promise<{ ok: boolean; message?: string }> {
  if ((party !== undefined && !validPartyEdit(party)) || !validEntryEdit(input, !!party && party.status !== "未回答")) return { ok: false, message: "種目と資格記録を確認してください（記録は1000文字以内）" };
  const client = await editClient();
  if (!client) return { ok: false, message: "権限がありません" };
  const args = { p_entry_id: input.entryId, p_profile_id: input.profileId, p_revision: input.revision, p_events: input.events, p_marks: input.marks };
  const result = party ? await client.rpc("save_ob_registration", { ...args, p_party_id: party.id, p_party_revision: party.revision, p_party_status: party.status }) : await client.rpc("save_ob_entry", args);
  if (result.error) {
    const message = result.error.code === "23505" ? "この部員の回答は既にあります。エントリー・懇親会の一覧から確認してください"
      : result.error.message.includes("entry_conflict") ? "他の操作で更新されています。画面を更新してからやり直してください"
      : result.error.message.includes("party_identity_required") ? "懇親会の回答と選択した部員が一致しません。本人照合を確認してください"
      : result.error.message.includes("entry_division_") ? "登録済みの男女区分と種目が一致しません。画面を更新して確認してください"
      : result.error.message.includes("entry_member_missing") ? "在籍中で氏名・学年が登録された部員を選んでください" : "保存できませんでした";
    return { ok: false, message };
  }
  refreshObPages();
  return { ok: true };
}

export async function confirmEntryMember(entryId: string, profileId: string | null, revision: number): Promise<{ ok: boolean; message?: string }> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(entryId) || (profileId !== null && !uuid.test(profileId)) || !Number.isSafeInteger(revision) || revision < 0) return { ok: false, message: "入力内容を確認してください" };
  const client = entryClient(await createClient());
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false, message: "ログインしてください" };
  const roles = await fetchRolesByProfileIds(await createClient(), [user.id]);
  if (!permissionsOf(roles.get(user.id)).manageSystem || await isMemberPreviewActive()) return { ok: false, message: "権限がありません" };
  if (profileId) {
    const member = await client.from("profiles").select("id").eq("id", profileId).eq("status", "active").eq("approved", true).maybeSingle();
    if (member.error || !member.data) return { ok: false, message: "在籍中の部員を選んでください" };
  }
  const saved = await client.from("ob_meet_entries").update({ profile_id: profileId, revision: revision + 1 })
    .eq("id", entryId).eq("meet_key", "ob-2026").eq("revision", revision).select("id").maybeSingle();
  if (saved.error?.code === "23505") return { ok: false, message: "この部員は別のエントリーに紐付いています" };
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
  const result=await client.rpc("save_ob_duty_roles",{p_profile_id:input.profileId,p_slot_time:input.slotTime,p_event_name:input.eventName,p_role_ids:input.roleIds,p_revision:input.revision});
  if(result.error)return {ok:false,message:dutyRoleError(result.error.message)};
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
  if(message.includes("role_full"))return "必要人数に達した役職があります。画面を更新して確認してください";
  if(message.includes("role_below_assigned"))return "割当済みの人数より少なくできません。先に担当を解除してください";
  if(message.includes("role_duplicate"))return "同じ名前の役職が登録されています";
  if(message.includes("entry_competing"))return "この時間帯に出場するため補助員に登録できません";
  if(message.includes("entry_conflict"))return "他の操作で更新されています。画面を更新してください";
  if(message.includes("role_names_too_long"))return "選択した役職名が長すぎます。役職名を短くしてください";
  return "保存できませんでした。入力内容を確認してください";
}
