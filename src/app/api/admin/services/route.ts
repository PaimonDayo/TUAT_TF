import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { MEMBER_PREVIEW_COOKIE } from "@/lib/member-preview";
import { getServiceStatus } from "@/lib/service-status";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "認証が必要です" }, { status: 401, headers });
    const roles = await fetchRolesByProfileIds(supabase, [user.id]);
    if (!permissionsOf(roles.get(user.id)).manageSystem || (await cookies()).get(MEMBER_PREVIEW_COOKIE)?.value === "1") {
      return NextResponse.json({ error: "システム管理権限が必要です" }, { status: 403, headers });
    }
    return NextResponse.json(await getServiceStatus(), { headers });
  } catch {
    return NextResponse.json({ error: "状態を取得できませんでした。時間をおいて再確認してください。" }, { status: 503, headers });
  }
}
