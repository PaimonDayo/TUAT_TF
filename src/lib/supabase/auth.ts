import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, role_links:profile_roles(role:roles(*))")
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
      grade: null,
      goal: null,
      role: "member",
      roles: [],
      status: "active",
      created_at: new Date().toISOString(),
    };
  }

  return normalizeProfileRoles(profile) as Profile;
}

/**
 * profile_roles の join 結果（{ role_links: [{ role: {...} }] }）を
 * profile.roles: AppRole[] に正規化する。
 */
export function normalizeProfileRoles<
  T extends { role_links?: { role: import("@/types").AppRole | null }[] | null },
>(profile: T): Omit<T, "role_links"> & { roles: import("@/types").AppRole[] } {
  const { role_links, ...rest } = profile;
  const roles = (role_links ?? [])
    .map((l) => l.role)
    .filter((r): r is import("@/types").AppRole => r !== null);
  return { ...rest, roles };
}
