"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds, isMemberPreviewActive } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { entryClient } from "@/lib/ob-entries-db";
import { validEntryEdit, type EntryEdit } from "@/lib/ob-entry-edit";

async function editClient() {
  const client = entryClient(await createClient());
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const roles = await fetchRolesByProfileIds(await createClient(), [user.id]);
  if (!permissionsOf(roles.get(user.id)).manageSystem || await isMemberPreviewActive()) return null;
  return client;
}

export async function saveEntry(input: EntryEdit): Promise<{ ok: boolean; message?: string }> {
  if (!validEntryEdit(input)) return { ok: false, message: "種目と資格記録を確認してください（記録は1000文字以内）" };
  const client = await editClient();
  if (!client) return { ok: false, message: "権限がありません" };
  const result = await client.rpc("save_ob_entry", { p_entry_id: input.entryId, p_profile_id: input.profileId, p_revision: input.revision, p_events: input.events, p_marks: input.marks });
  if (result.error) {
    const message = result.error.code === "23505" ? "この部員のエントリーは既にあります。全員一覧で確認してください"
      : result.error.message.includes("entry_conflict") ? "他の操作で更新されています。画面を更新してからやり直してください"
      : result.error.message.includes("entry_member_missing") ? "在籍中で氏名・学年が登録された部員を選んでください" : "保存できませんでした";
    return { ok: false, message };
  }
  revalidatePath("/ob-entries");
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
  revalidatePath("/ob-entries");
  return { ok: true };
}
