import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { runSheetSync } from "@/lib/sheet-sync";

export const maxDuration = 30;

/** システム管理ロールの検証中だけ使う、本人1シート分の軽量CSV同期。 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const roles = await fetchRolesByProfileIds(supabase, [user.id]);
  if (!permissionsOf(roles.get(user.id)).manageSystem) {
    return NextResponse.json({ error: "システム管理権限が必要です" }, { status: 403 });
  }
  if (process.env.SHEET_SYNC_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: true, changed: false, cycleComplete: true });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("sheet_name")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    return NextResponse.json({ ok: false, error: "プロフィールを取得できませんでした" }, { status: 500 });
  }
  const sheetName = profile?.sheet_name?.trim();
  if (!sheetName) {
    return NextResponse.json({ ok: true, skipped: true, changed: false, cycleComplete: true });
  }

  try {
    const result = await runSheetSync(createAdminClient(), { onlySheet: sheetName });
    return NextResponse.json({
      ok: true,
      changed: result.inserted + result.updated + result.sheetReplies > 0,
      inserted: result.inserted,
      updated: result.updated,
      failedMembers: result.failedMembers,
      cycleComplete: true,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "同期に失敗しました" },
      { status: 500 },
    );
  }
}
