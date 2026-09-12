// 部員・ロール・お気に入りの取得。

import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { normalizeAuthorRow, normalizeProfileRow } from "@/lib/profile-normalize";
import type { AppRole, RoleCategory, AuthorMini } from "@/types";

/** プロフィール単体取得（他部員ページ用。ロール込み） */
export async function getProfileById(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  if (!data) return null;
  const rolesMap = await fetchRolesByProfileIds(supabase, [id]);
  return normalizeProfileRow(data, rolesMap.get(id) ?? []);
}

/** 全部員一覧（管理者画面用。ロール込み） */
export async function getAllProfiles() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load profiles: ${error.message}`);
  const rows = data ?? [];
  const rolesMap = await fetchRolesByProfileIds(
    supabase,
    rows.map((p) => p.id as string),
  );
  return rows.map((profile) => normalizeProfileRow(profile, rolesMap.get(profile.id) ?? []));
}

/** メンバー一覧（在籍中かつ承認済みの部員。名簿表示用） */
export async function getMembersList(): Promise<AuthorMini[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, blocks, grade")
    .eq("status", "active")
    .eq("approved", true)
    .order("display_name", { ascending: true });
  return (data ?? []).map(normalizeAuthorRow);
}

/** 全ロール定義を取得（管理画面用） */
export async function getAllRoles(): Promise<AppRole[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("roles")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as AppRole[];
}

/** ロールカテゴリ一覧を取得（管理画面用） */
export async function getAllRoleCategories(): Promise<RoleCategory[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("role_categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as RoleCategory[];
}
/** 自分がお気に入り登録している部員IDの一覧 */
export async function getMyFavoriteIds(userId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("favorites")
    .select("favorite_user_id")
    .eq("user_id", userId);
  return (data ?? []).map((f) => f.favorite_user_id as string);
}

/** 自分が対象ユーザーをお気に入り登録しているか */
export async function isFavorite(userId: string, targetId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("favorites")
    .select("favorite_user_id")
    .eq("user_id", userId)
    .eq("favorite_user_id", targetId)
    .maybeSingle();
  return !!data;
}
