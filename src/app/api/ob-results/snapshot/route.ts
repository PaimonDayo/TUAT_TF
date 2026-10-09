import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { timingSafeEqualString } from "@/lib/timing-safe";
import { getObPublishedResults } from "@/lib/queries/ob-results-publish";
import { OB_MEET } from "@/lib/ob-meet";
import { obPublishedResultSheets } from "@/lib/ob-results-sheet";
import { obResultsFeedToken, OB_RESULTS_SPREADSHEET_ID } from "@/lib/ob-results-feed-auth";

export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", "Vary": "Authorization" };

/** Fixed OB2026 export only. This key cannot call any update or general-purpose sync API. */
export async function GET(request: Request) {
  const secret = process.env.SHEET_SYNC_SECRET;
  if (!secret) return NextResponse.json({ error: "共有用の取得を設定できていません" }, { status: 503, headers });
  if (!timingSafeEqualString(request.headers.get("authorization") ?? "", `Bearer ${obResultsFeedToken(secret)}`)) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401, headers });
  }
  try {
    const { entries, operations } = await getObPublishedResults(createAdminClient());
    const sheets = obPublishedResultSheets(entries, operations);
    const revision = createHash("sha256").update(JSON.stringify(sheets)).digest("hex");
    return NextResponse.json({ schemaVersion: 1, meetKey: OB_MEET.meetKey, spreadsheetId: OB_RESULTS_SPREADSHEET_ID,
      generatedAt: new Date().toISOString(), entryCount: entries.length, revision, sheets }, { headers });
  } catch {
    // Never return an empty workbook for a failed or incomplete read.
    return NextResponse.json({ error: "共有用の組・記録を取得できませんでした。前回のスプレッドシートを保持します" }, { status: 503, headers });
  }
}
