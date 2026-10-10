import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { timingSafeEqualString } from "@/lib/timing-safe";
import { obResultsStatusToken } from "@/lib/ob-results-feed-auth";
import { OB_SHEET_STATUSES, readObSheetTarget } from "@/lib/ob-sheet-status";
import { OB_PROGRAM_PATH } from "@/lib/ob-meet";
import type { Json } from "@/types/database";
import { operationClient } from "@/lib/ob-operations-db";

export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function authorized(request: Request) {
  const key = process.env.SHEET_SYNC_SECRET;
  return key && timingSafeEqualString(request.headers.get("authorization") ?? "", `Bearer ${obResultsStatusToken(key)}`) ? key : null;
}

export async function POST(request: Request) {
  const secret = authorized(request);
  if (!secret) return NextResponse.json({ error: "認証が必要です" }, { status: 401, headers });
  try {
    const text = await request.text();
    if (text.length > 500000) return NextResponse.json({ error: "変更件数を確認してください" }, { status: 400, headers });
    const input = JSON.parse(text);
    if (!uuid.test(input.requestId) || typeof input.dryRun !== "boolean" || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 600) {
      return NextResponse.json({ error: "変更内容を確認してください" }, { status: 400, headers });
    }
    const changes = input.changes.map((change: { token?: unknown; status?: unknown }) => {
      const target = readObSheetTarget(change?.token, secret);
      if (!target || typeof change.status !== "string" || !Object.hasOwn(OB_SHEET_STATUSES, change.status)) throw new Error("invalid");
      return { ...target, status: OB_SHEET_STATUSES[change.status as keyof typeof OB_SHEET_STATUSES] };
    });
    if (new Set(changes.map((row: { entryId: string; event: string }) => `${row.entryId}:${row.event}`)).size !== changes.length) throw new Error("invalid");
    const { data, error } = await operationClient(createAdminClient()).rpc("apply_ob_sheet_statuses", {
      p_request_id: input.requestId, p_changes: changes as Json, p_dry_run: input.dryRun,
    });
    if (error) return NextResponse.json({ error: "アプリ側の変更と競合したか、保存を確認できませんでした。スプシの入力を保持します" }, { status: ["40001", "P0001"].includes(error.code) ? 409 : 503, headers });
    if (!data || typeof data !== "object" || Array.isArray(data) || data.requestId !== input.requestId || data.count !== changes.length) throw new Error("uncertain");
    if (!input.dryRun) revalidatePath(OB_PROGRAM_PATH);
    return NextResponse.json(data, { headers });
  } catch {
    return NextResponse.json({ error: "変更内容または保存結果を確認できませんでした。スプシの入力を保持します" }, { status: 400, headers });
  }
}
