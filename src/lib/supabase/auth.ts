import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/types";
import { normalizeProfileRow } from "@/lib/profile-normalize";
import { hasPermission } from "@/lib/permissions";
import { MEMBER_PREVIEW_COOKIE } from "@/lib/member-preview";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

/**
 * 現在ログイン中のユーザーのプロフィールを取得する。
 * 未ログインなら /login へリダイレクト。
 *
 * 画面遷移のセッション検証・トークン更新は proxy.ts で行うため、ここでは
 * ネットワークを使わない getSession でユーザーIDだけ取り出す。API Routeは
 * Proxy対象外なので、各Route HandlerがgetUserまたはBearerで直接認証する。
 * データ自体のアクセス制御は Supabase の RLS が担保する。
 */
const getStoredProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;

  if (!user) redirect("/login");

  // ロール取得とは切り離してプロフィール本体を取得する。
  // （roles テーブル未適用などでロール取得に失敗しても、名前等は表示できるように）
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Failed to load current profile: ${profileError.message}`);
  }
  // トリガー未作成等で行が無い場合の保険
  if (!profile) {
    return {
    notify_mention: true,
      id: user.id,
      email: user.email ?? "",
      display_name: "",
      mention_reading: null,
      avatar_url: null,
      blocks: [],
      events: [],
      grade: null,
      goal: null,
      role: "member",
      roles: [],
      status: "active",
      approved: true,
      notify_comment: true,
      notify_notice: true,
      menu_view_all_blocks: false,
      schedule_view_all_blocks: false,
      attendance_view_all_blocks: false,
      attendance_default_block: "all",
      timeline_default_block: "all",
      sheet_name: null,
      sheet_linked_at: null,
      sheet_history_imported_at: null,
      sheet_header_signature: null,
      record_source: "app",
      record_fields: [],
      record_fields_version: 1,
      created_at: new Date().toISOString(),
    };
  }

  const rolesMap = await fetchRolesByProfileIds(supabase, [user.id]);
  return normalizeProfileRow(profile, rolesMap.get(user.id) ?? []);
});

/**
 * 本来の権限を持つプロフィール。一般部員プレビューの切り替えUIなど、
 * 「プレビュー中でも本当の権限で判定したい」ところだけで使う。
 */
export const getRealCurrentProfile = getStoredProfile;

/** 一般部員プレビューが有効か。システム管理者以外では常に false。 */
export const isMemberPreviewActive = cache(async (): Promise<boolean> => {
  const store = await cookies();
  if (store.get(MEMBER_PREVIEW_COOKIE)?.value !== "1") return false;
  const profile = await getStoredProfile();
  return hasPermission(profile.roles, "manage_system");
});

/**
 * 画面を組み立てるときのプロフィール。一般部員プレビュー中は権限フラグだけを
 * 落として返すので、権限で出し分けている画面がそのまま一般部員の見え方になる。
 * ロール名や色は残すので、肩書きの表示は本来のまま。
 */
export const getCurrentProfile = cache(async (): Promise<Profile> => {
  const profile = await getStoredProfile();
  if (!(await isMemberPreviewActive())) return profile;
  return {
    ...profile,
    roles: profile.roles.map((role) => ({
      ...role,
      can_manage_system: false,
      can_manage_members: false,
      can_create_schedule: false,
      can_create_menu: false,
      can_create_notice: false,
      can_decide_practice: false,
    })),
  };
});

/**
 * 指定プロフィール群のロールをまとめて取得する。
 * roles / profile_roles 未適用やエラー時は空マップを返す（プロフィール表示は壊さない）。
 */
export async function fetchRolesByProfileIds(
  supabase: SupabaseServer,
  ids: string[],
): Promise<Map<string, AppRole[]>> {
  const map = new Map<string, AppRole[]>();
  if (ids.length === 0) return map;

  const [{ data, error }, { data: everyoneRoles }] = await Promise.all([
    supabase
      .from("profile_roles")
      .select("profile_id, role:roles(*)")
      .in("profile_id", ids),
    supabase.from("roles").select("*").eq("is_everyone", true),
  ]);

  if (error || !data) return map;

  const globalRoles = (everyoneRoles ?? []) as AppRole[];
  for (const id of ids) map.set(id, [...globalRoles]);

  for (const row of data) {
    if (!row.role || row.role.is_everyone) continue;
    const arr = map.get(row.profile_id) ?? [];
    arr.push(row.role);
    map.set(row.profile_id, arr);
  }  for (const roles of map.values()) {
    roles.sort((a, b) => a.sort_order - b.sort_order);
  }
  return map;
}
