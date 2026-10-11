import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pcAppWriteProtectionResponse, pcBackupProtectionResponse } from "@/lib/pc-backup-status";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { runSheetSync } from "@/lib/sheet-sync";
import { timingSafeEqualString } from "@/lib/timing-safe";
import { sheetSyncChunkSize } from "@/lib/sheet-sync-chunk";
import { forwardPcCron } from "@/lib/pc-cron-forward";

export async function GET(request: Request) { return forwardPcCron(request, POST); }

// 毎日0時（JST）の1回で最大100人を処理する。主な待ち時間はGASへのI/O。
export const maxDuration = 300;

type SyncChunk = {
  sheetNames: string[];
  startOffset: number;
  endOffset: number;
  totalMembers: number;
  cycleComplete: boolean;
};

/**
 * 練習記録のスプシ⇔アプリ連携を実行する。
 * 認可は2系統:
 *   - pg_cron（毎日0時JST）: ヘッダ `Authorization: Bearer <SHEET_SYNC_SECRET>`
 *   - 管理者の手動実行: ログイン中かつ「部員・ロール管理」権限
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await request.json().catch(() => ({}));
  const dryRun = body?.dryRun === true;
  const onlySheet = typeof body?.onlySheet === "string" ? body.onlySheet : undefined;
  const resetCycle = body?.resetCycle === true;
  const skipSheetWrites = body?.skipSheetWrites === true;

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
  if (!dryRun) {
    const protectedResponse = await pcAppWriteProtectionResponse();
    if (protectedResponse) return protectedResponse;
  }

  // "running"放置の解消: タイムアウト等で前回以前のrunがrunningのまま残っていたら
  // ここでerrorへ倒す（2026-07-02/03に発生した放置の再発防止）。
  if (!dryRun) {
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const staleResult = await admin
      .from("sheet_sync_runs")
      .update({
        status: "error",
        error_text: "タイムアウトのため中断（次回実行時に自動検出）",
        finished_at: new Date().toISOString(),
      })
      .eq("status", "running")
      .lt("started_at", staleThreshold);
    if (staleResult.error) return pcBackupProtectionResponse(staleResult.error)
      ?? NextResponse.json({ ok: false, error: "前回の連携状態を確認できませんでした" }, { status: 500 });
  }

  let chunk: SyncChunk | undefined;
  if (!onlySheet) {
    try {
      chunk = dryRun
        ? await previewFirstChunk(admin)
        : await claimNextChunk(admin, resetCycle && trigger === "manual");
    } catch (error) {
      const protection = pcBackupProtectionResponse(error) ?? (!dryRun ? await pcAppWriteProtectionResponse() : null);
      if (protection) return protection;
      const message = error instanceof Error ? error.message : "Failed to prepare sync chunk";
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // ドライランはログを残さない
  const { data: run, error: runError } = dryRun
    ? { data: undefined, error: null }
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
  if (!dryRun && (runError || !runId)) return pcBackupProtectionResponse(runError)
    ?? NextResponse.json({ ok: false, error: "連携の開始記録を確認できませんでした", resultUnknown: true, retryable: false }, { status: 500 });

  try {
    const result = await runSheetSync(admin, {
      dryRun,
      onlySheet,
      onlySheets: chunk?.sheetNames,
      skipSheetWrites,
      // Midnight cron publishes completed days; an administrator's manual pull
      // can explicitly retrieve today's entries without waiting for midnight.
      includeToday: !isCron,
    });
    if (!dryRun && (result.failedMembers.length || result.sheetWritesSkipped)) {
      const protection = await pcAppWriteProtectionResponse();
      if (protection) return NextResponse.json({ ...await protection.json(), ok: false, outcome: "partial", retryable: false, result, chunk },
        { status: 503, headers: { "cache-control": "private, no-store" } });
    }
    console.info("sheet_sync_complete", {
      trigger,
      durationMs: Date.now() - startedAt,
      processedMembers: (chunk?.sheetNames.length ?? (onlySheet ? 1 : 0)) - result.unchangedMembers.length,
      unchangedMembers: result.unchangedMembers.length,
      inserted: result.inserted,
      updated: result.updated,
      pushed: result.pushed,
      failures: result.failedMembers.length,
    });
    if (runId) {
      const finished = await admin
        .from("sheet_sync_runs")
        .update({
          status: result.sheetWritesSkipped || result.failedMembers.length > 0 ? "error" : "success",
          pulled_count: result.inserted + result.updated,
          pushed_count: result.pushed,
          failed_members: result.failedMembers,
          error_text:
            result.failedMembers.length > 0
              ? `${result.failedMembers.length}件が部分失敗（詳細はfailed_members参照）`
              : result.sheetWritesSkipped ? "送信を保留し、記録の取り込みのみ実行しました" : null,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId)
        .select("id");
      if (finished.error || finished.data?.length !== 1) {
        const protection = pcBackupProtectionResponse(finished.error);
        return NextResponse.json({ ok: false, error: "連携処理後の完了記録を確認できませんでした。再実行せず、状態を確認してください。",
          code: protection ? "PC_BACKUP_UNAVAILABLE" : "SHEET_SYNC_RECEIPT_UNCONFIRMED", outcome: "partial", retryable: false, result, chunk, runId },
        { status: protection ? 503 : 502, headers: { "cache-control": "private, no-store" } });
      }
    }
    return NextResponse.json({ ok: true, ...result, chunk });
  } catch (err) {
    const protection = pcBackupProtectionResponse(err) ?? (!dryRun ? await pcAppWriteProtectionResponse() : null);
    if (protection) return protection;
    const message = err instanceof Error ? err.message : "連携できませんでした";
    console.error("sheet_sync_failed", {
      trigger,
      durationMs: Date.now() - startedAt,
      message,
    });
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
