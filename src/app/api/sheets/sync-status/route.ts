import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = await fetchRolesByProfileIds(supabase, [user.id]);
  const permissions = permissionsOf(roles.get(user.id));
  if (!permissions.manageSystem && !permissions.manageMembers) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const [runsResult, pendingResult, profilesResult] = await Promise.all([
    admin.from("sheet_sync_runs").select("status, started_at, finished_at, pulled_count, pushed_count, failed_members").order("started_at", { ascending: false }).limit(1),
    admin.from("practice_records").select("id", { count: "exact", head: true }).eq("pending_sheet_push", true),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("record_source", "sheet"),
  ]);
  if (runsResult.error || pendingResult.error || profilesResult.error) return NextResponse.json({ error: "同期状態を取得できませんでした" }, { status: 500 });

  const latest = runsResult.data?.[0] ?? null;
  const failedMembers = Array.isArray(latest?.failed_members) ? latest.failed_members : [];
  return NextResponse.json({
    latest: latest && {
      status: latest.status,
      startedAt: latest.started_at,
      finishedAt: latest.finished_at,
      pulledCount: latest.pulled_count ?? 0,
      pushedCount: latest.pushed_count ?? 0,
      failedCount: failedMembers.length,
      hasIssue: latest.status === "error" || failedMembers.length > 0,
    },
    pendingPushCount: pendingResult.count ?? 0,
    sheetProfileCount: profilesResult.count ?? 0,
  });
}