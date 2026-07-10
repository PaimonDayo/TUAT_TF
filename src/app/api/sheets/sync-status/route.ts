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
  if (!permissionsOf(roles.get(user.id)).manageMembers) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await createAdminClient().from("sheet_sync_runs")
    .select("status, started_at, finished_at, failed_members")
    .order("started_at", { ascending: false }).limit(1);
  if (error) return NextResponse.json({ error: "同期履歴を取得できませんでした" }, { status: 500 });

  const latest = data?.[0] ?? null;
  const failedMembers = Array.isArray(latest?.failed_members) ? latest.failed_members : [];
  return NextResponse.json({ latest: latest && { status: latest.status, startedAt: latest.started_at, finishedAt: latest.finished_at, failedCount: failedMembers.length, hasIssue: latest.status === "error" || failedMembers.length > 0 } });
}
