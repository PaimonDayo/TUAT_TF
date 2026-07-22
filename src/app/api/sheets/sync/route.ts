import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { runSheetSync } from "@/lib/sheet-sync";
import { timingSafeEqualString } from "@/lib/timing-safe";
import { sheetSyncChunkSize } from "@/lib/sheet-sync-chunk";

// 同期はネットワーク往復が多いので余裕を持たせる
export const maxDuration = 60;

type SyncChunk = {
  sheetNames: string[];
  startOffset: number;
  endOffset: number;
  totalMembers: number;
  cycleComplete: boolean;
};

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
  const resetCycle = body?.resetCycle === true;

  const secret = process.env.SHEET_SYNC_SECRET;
  const authHeader = request.headers.get("authorization") ?? "";

  let trigger: "cron" | "manual" = "cron";
  let triggeredBy: string | null = null;

  const isCron = Boolean(secret) && timingSafeEqualString(authHeader, `Bearer ${secret}`);
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

  // "running"放置の解消: タイムアウト等で前回以前のrunがrunningのまま残っていたら
  // ここでerrorへ倒す（2026-07-02/03に発生した放置の再発防止）。
  if (!dryRun) {
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await admin
      .from("sheet_sync_runs")
      .update({
        status: "error",
        error_text: "タイムアウトのため中断（次回実行時に自動検出）",
        finished_at: new Date().toISOString(),
      })
      .eq("status", "running")
      .lt("started_at", staleThreshold);
  }

  let chunk: SyncChunk | undefined;
  if (!onlySheet) {
    try {
      chunk = dryRun
        ? await previewFirstChunk(admin)
        : await claimNextChunk(admin, resetCycle && trigger === "manual");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to prepare sync chunk";
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // ドライランはログを残さない
  const { data: run } = dryRun
    ? { data: undefined }
    : await admin
        .from("sheet_sync_runs")
        .insert({
          trigger,
          triggered_by: triggeredBy,
          status: "running",
          chunk_start: chunk?.startOffset ?? null,
          chunk_end: chunk?.endOffset ?? null,
          total_members: chunk?.totalMembers ?? null,
          cycle_complete: chunk?.cycleComplete ?? false,
        })
        .select("id")
        .single();
  const runId = run?.id as string | undefined;

  try {
    const result = await runSheetSync(admin, {
      dryRun,
      onlySheet,
      onlySheets: chunk?.sheetNames,
    });
    if (runId) {
      await admin
        .from("sheet_sync_runs")
        .update({
          status: "success",
          pulled_count: result.inserted + result.updated,
          pushed_count: result.pushed,
          failed_members: result.failedMembers,
          error_text:
            result.failedMembers.length > 0
              ? `${result.failedMembers.length}件が部分失敗（詳細はfailed_members参照）`
              : null,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return NextResponse.json({ ok: true, ...result, chunk });
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


async function previewFirstChunk(
  admin: ReturnType<typeof createAdminClient>,
): Promise<SyncChunk> {
  const { data, count, error } = await admin
    .from("profiles")
    .select("id, sheet_name", { count: "exact" })
    .not("sheet_name", "is", null)
    .neq("sheet_name", "")
    .order("sheet_name", { ascending: true })
    .order("id", { ascending: true })
    .limit(sheetSyncChunkSize());
  if (error) throw error;
  const sheetNames = (data ?? [])
    .map((profile) => profile.sheet_name?.trim())
    .filter((name): name is string => Boolean(name));
  const totalMembers = count ?? sheetNames.length;
  return {
    sheetNames,
    startOffset: 0,
    endOffset: sheetNames.length,
    totalMembers,
    cycleComplete: sheetNames.length >= totalMembers,
  };
}

async function claimNextChunk(
  admin: ReturnType<typeof createAdminClient>,
  resetCycle: boolean,
): Promise<SyncChunk> {
  const { data, error } = await admin.rpc("claim_sheet_sync_chunk", {
    requested_chunk_size: sheetSyncChunkSize(),
    reset_cycle: resetCycle,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid sync chunk response");
  }
  const value = data as Record<string, unknown>;
  const sheetNames = Array.isArray(value.sheetNames)
    ? value.sheetNames.filter((name): name is string => typeof name === "string")
    : [];
  const startOffset = Number(value.startOffset);
  const endOffset = Number(value.endOffset);
  const totalMembers = Number(value.totalMembers);
  if (![startOffset, endOffset, totalMembers].every(Number.isFinite)) {
    throw new Error("Invalid sync chunk counters");
  }
  return {
    sheetNames,
    startOffset,
    endOffset,
    totalMembers,
    cycleComplete: value.cycleComplete === true,
  };
}
