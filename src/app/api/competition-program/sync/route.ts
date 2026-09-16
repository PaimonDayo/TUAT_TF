import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { timingSafeEqualString } from "@/lib/timing-safe";
import { forwardPcCron } from "@/lib/pc-cron-forward";
import { decodeShiftJisHtml, parseCompetitionProgram } from "@/lib/competition-program";
import type { Json } from "@/types/database";

export async function GET(request: Request) { return forwardPcCron(request, POST); }

export const maxDuration = 60;

/**
 * 大会プログラム（速報サイトのタイムテーブル）を取り込む。
 * 認可: 記録・予定の同期と同じ二系統（pg_cron/Vercel Cron の Bearer、またはシステム管理者の手動実行）。
 * competitions.program_source_url を設定した大会だけが対象。全件洗い替え（差分計算はしない）。
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
    .select("id,starts_on,program_source_url")
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
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`取得に失敗しました（${response.status}）`);
      const buffer = await response.arrayBuffer();
      const html = decodeShiftJisHtml(buffer);
      const year = new Date(competition.starts_on).getFullYear();
      const rows = parseCompetitionProgram(html, year);

      const { error: deleteError } = await admin
        .from("competition_program_entries")
        .delete()
        .eq("competition_id", competition.id);
      if (deleteError) throw deleteError;

      if (rows.length > 0) {
        const { error: insertError } = await admin.from("competition_program_entries").insert(
          rows.map((row) => ({
            competition_id: competition.id,
            event_date: row.eventDate,
            block: row.block,
            sort_order: row.sortOrder,
            time_label: row.timeLabel,
            round_key: row.roundKey,
            event_label: row.eventLabel,
            status: row.status,
            tuat_entries: row.tuatEntries as unknown as Json,
          })),
        );
        if (insertError) throw insertError;
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
