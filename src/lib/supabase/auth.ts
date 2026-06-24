import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/types";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

/**
 * 現在ログイン中のユーザーのプロフィールを取得する。
 * 未ログインなら /login へリダイレクト。
 *
 * セッション検証・トークン更新は proxy.ts（毎リクエストの getUser）で行うため、
 * ここではネットワークを使わない getSession でユーザーIDだけ取り出す。
 * データ自体のアクセス制御は Supabase の RLS が担保する。
 */
export async function getCurrentProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;

  if (!user) redirect("/login");

  // ロール取得とは切り離してプロフィール本体を取得する。
  // （roles テーブル未適用などでロール取得に失敗しても、名前等は表示できるように）
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // トリガー未作成等で行が無い場合の保険
  if (!profile) {
    return {
      id: user.id,
      email: user.email ?? "",
      display_name: "",
      avatar_url: null,
      blocks: [],
      events: [],
      grade: null,
      goal: null,
      role: "member",
      roles: [],
      status: "active",
      approved: false,
      notify_comment: true,
      notify_notice: true,
      menu_view_all_blocks: false,
      sheet_name: null,
      record_fields: [],
      created_at: new Date().toISOString(),
    };
  }

  const rolesMap = await fetchRolesByProfileIds(supabase, [user.id]);
  return { ...profile, roles: rolesMap.get(user.id) ?? [] } as Profile;
}

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

  const { data, error } = await supabase
    .from("profile_roles")
    .select("profile_id, role:roles(*)")
    .in("profile_id", ids);

  if (error || !data) return map;

  for (const row of data as unknown as { profile_id: string; role: AppRole | null }[]) {
    if (!row.role) continue;
    const arr = map.get(row.profile_id) ?? [];
    arr.push(row.role);
    map.set(row.profile_id, arr);
  }
  for (const roles of map.values()) {
    roles.sort((a, b) => a.sort_order - b.sort_order);
  }
  return map;
}
