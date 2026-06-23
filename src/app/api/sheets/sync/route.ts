import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { runSheetSync } from "@/lib/sheet-sync";

// 同期はネットワーク往復が多いので余裕を持たせる
export const maxDuration = 60;

/**
 * 練習記録のスプシ⇔アプリ双方向同期を実行する。
 * 認可は2系統:
 *   - pg_cron / 外部スケジューラ: ヘッダ `Authorization: Bearer <SHEET_SYNC_SECRET>`
 *   - 管理者の手動実行: ログイン中かつ「部員・ロール管理」権限
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const dryRun = body?.dryRun === true;
  const onlySheet = typeof body?.onlySheet === "string" ? body.onlySheet : undefined;

  const secret = process.env.SHEET_SYNC_SECRET;
  const authHeader = request.headers.get("authorization") ?? "";

  let trigger: "cron" | "manual" = "cron";
  let triggeredBy: string | null = null;

  const isCron = Boolean(secret) && authHeader === `Bearer ${secret}`;
  if (!isCron) {
    // 手動実行: 管理者のみ
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const rolesMap = await fetchRolesByProfileIds(supabase, [user.id]);
    if (!permissionsOf(rolesMap.get(user.id)).manageMembers) {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }
    trigger = "manual";
    triggeredBy = user.id;
  }

  // 実際の書き込み（dryRun以外）は env SHEET_SYNC_ENABLED=true のときだけ許可。
  // ドライラン（確認）は読み取り専用なので常に許可する。
  if (!dryRun && process.env.SHEET_SYNC_ENABLED !== "true") {
    return NextResponse.json(
      { ok: false, error: "本番反映は無効化中です（確認=ドライランのみ可能）" },
      { status: 503 },
    );
  }

  const admin = createAdminClient();

  // ドライランはログを残さない
  const { data: run } = dryRun
    ? { data: undefined }
    : await admin
        .from("sheet_sync_runs")
        .insert({ trigger, triggered_by: triggeredBy, status: "running" })
        .select("id")
        .single();
  const runId = run?.id as string | undefined;

  try {
    const result = await runSheetSync(admin, { dryRun, onlySheet });
    if (runId) {
      await admin
        .from("sheet_sync_runs")
        .update({
          status: "success",
          pulled_count: result.inserted + result.updated,
          pushed_count: result.pushed,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "同期に失敗しました";
    if (runId) {
      await admin
        .from("sheet_sync_runs")
        .update({
          status: "error",
          error_text: message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
