import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { timingSafeEqualString } from "@/lib/timing-safe";
import { forwardPcCron } from "@/lib/pc-cron-forward";
import { decodeShiftJisHtml, parseCompetitionProgram, retainProgramPositions, validateProgramImport, fromStoredProgramRow } from "@/lib/competition-program";
import type { CompetitionProgramEntryRow } from "@/types";
import type { Json } from "@/types/database";

export async function GET(request: Request) { return forwardPcCron(request, POST); }

export const maxDuration = 60;

/**
 * 大会プログラム（速報サイトのタイムテーブル）を取り込む。
 * 認可: 記録・予定の同期と同じ二系統（pg_cron/Vercel Cron の Bearer、またはシステム管理者の手動実行）。
 * competitions.program_source_url を設定した大会だけが対象。完全なページだけを検証し、DB関数の単一トランザクションで入れ替える。
 * 1件が取得・解析に失敗しても他の大会の取込は止めない。
 */
export async function POST(request: Request) {
  const secret = process.env.SHEET_SYNC_SECRET;
  const authHeader = request.headers.get("authorization") ?? "";
  const isCron = Boolean(secret) && timingSafeEqualString(authHeader, `Bearer ${secret}`);
  if (!isCron) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const rolesMap = await fetchRolesByProfileIds(supabase, [user.id]);
    if (!permissionsOf(rolesMap.get(user.id)).manageSystem) {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const onlyCompetitionId = typeof body?.competitionId === "string" ? body.competitionId : undefined;

  const admin = createAdminClient();
  let query = admin
    .from("competitions")
    .select("id,starts_on,ends_on,program_source_url")
    .not("program_source_url", "is", null);
  if (onlyCompetitionId) query = query.eq("id", onlyCompetitionId);
  const { data: competitions, error: competitionsError } = await query;
  if (competitionsError) {
    return NextResponse.json({ ok: false, error: competitionsError.message }, { status: 500 });
  }

  const results: { competitionId: string; ok: boolean; rows?: number; entries?: number; error?: string }[] = [];

  for (const competition of competitions ?? []) {
    const sourceUrl = competition.program_source_url;
    if (!sourceUrl) continue;
    try {
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
      const start = Date.parse(competition.starts_on);
      const end = Date.parse(competition.ends_on ?? competition.starts_on);
      const now = Date.parse(today);
      if (!onlyCompetitionId && (start > now + 86400000 || end < now - 2 * 86400000)) continue;
      const url = new URL(sourceUrl);
      if (url.hostname !== "sairiku.net" || !/^https?:$/.test(url.protocol) || !url.pathname.startsWith("/result/") || url.username || url.password || url.port) throw new Error("対応していない取得元URLです");
      const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`取得に失敗しました（${response.status}）`);
      const buffer = await response.arrayBuffer();
      const html = decodeShiftJisHtml(buffer);
      const year = new Date(competition.starts_on).getFullYear();
      const { data: previous, error: readError } = await admin.from("competition_program_entries").select("*").eq("competition_id", competition.id);
      if (readError) throw readError;
      const parsed = parseCompetitionProgram(html, year);
      validateProgramImport(html, parsed, previous?.length ?? 0);
      const rows = retainProgramPositions(parsed, ((previous ?? []) as unknown as CompetitionProgramEntryRow[]).map(fromStoredProgramRow));
      const stored = rows.map(row => ({ event_date: row.eventDate, block: row.block, sort_order: row.sortOrder,
        time_label: row.timeLabel, round_key: row.roundKey, event_label: row.eventLabel, status: row.status,
        tuat_entries: row.tuatEntries }));
      if (!body?.dryRun) {
        const { error: writeError } = await admin.rpc("replace_competition_program", { target_competition_id: competition.id, program_rows: stored as unknown as Json });
        if (writeError) throw writeError;
      }

      const entries = rows.reduce((sum, row) => sum + row.tuatEntries.length, 0);
      results.push({ competitionId: competition.id, ok: true, rows: rows.length, entries });
    } catch (error) {
      const message = error instanceof Error ? error.message : "取込できませんでした";
      results.push({ competitionId: competition.id, ok: false, error: message });
    }
  }

  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
