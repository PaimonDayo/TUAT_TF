import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { timingSafeEqualString } from "@/lib/timing-safe";
import { obResultsStatusToken } from "@/lib/ob-results-feed-auth";
import { OB_SHEET_STATUSES, readObSheetTarget } from "@/lib/ob-sheet-status";
import { readObEditContext, OB_EDIT_EVENTS, OB_EDIT_GRADES } from "@/lib/ob-sheet-edits";
import { OB_PROGRAM_PATH } from "@/lib/ob-meet";
import { operationClient } from "@/lib/ob-operations-db";
import type { Json } from "@/types/database";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
export async function POST(request: Request) {
  const secret = process.env.SHEET_SYNC_SECRET;
  if (!secret || !timingSafeEqualString(request.headers.get("authorization") ?? "", "Bearer " + obResultsStatusToken(secret))) return NextResponse.json({ error: "認証が必要です" }, { status: 401, headers });
  let input, changes;
  let context: ReturnType<typeof readObEditContext> = null;
  try {
    const text = await request.text(); if (text.length > 500000) throw Error();
    input = JSON.parse(text); context = readObEditContext(input.context, secret);
    if (!context || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId) || typeof input.dryRun !== "boolean" || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 600) throw Error();
    changes = input.changes.map((raw: Record<string, unknown>) => {
      if (raw.token) {
        const target = readObSheetTarget(raw.token, secret);
        if (!target || typeof raw.status !== "string" || !Object.hasOwn(OB_SHEET_STATUSES, raw.status)) throw Error();
        return { ...target, status: OB_SHEET_STATUSES[raw.status as keyof typeof OB_SHEET_STATUSES], position: false, newKey: null, name: null, grade: null };
      }
      if (!raw || typeof raw.key !== "string" || typeof raw.family !== "string" || !OB_EDIT_EVENTS.includes(raw.family) || !["男子", "女子"].includes(String(raw.division))
        || typeof raw.status !== "string" || !Object.hasOwn(OB_SHEET_STATUSES, raw.status) || typeof raw.position !== "boolean") throw Error();
      const event = raw.division + raw.family, entry = context!.entries.find(e => e.key === raw.key);
      if (raw.key && !entry) throw Error();
      if (!entry && (typeof raw.name !== "string" || raw.name.trim().length < 1 || raw.name.length > 100 || typeof raw.grade !== "string" || !OB_EDIT_GRADES.includes(raw.grade))) throw Error();
      const group = raw.group, order = raw.order;
      if (raw.position && (!(group === null || Number.isInteger(group) && Number(group) >= 1 && Number(group) <= 99) || !(order === null || Number.isInteger(order) && Number(order) >= 1 && Number(order) <= 600) || !["男子", "女子", "混合"].includes(String(raw.heatScope)))) throw Error();
      const name = entry ? null : (raw.name as string).trim();
      return { entryId: entry?.id ?? null, entryRevision: entry?.revision ?? null, event, operationRevision: context!.operations.find(o => o.event === event)?.revision ?? null,
        status: OB_SHEET_STATUSES[raw.status as keyof typeof OB_SHEET_STATUSES], position: raw.position,
        ...(raw.position ? { group, order, heatScope: raw.heatScope } : {}), name, grade: entry ? null : raw.grade,
        newKey: name ? name.normalize("NFKC").replace(/[\s\u3000]/g, "") : null };
    });
    if (new Set(changes.map((c: { entryId: string | null; newKey: string | null; event: string }) => `${c.entryId ?? c.newKey}:${c.event}`)).size !== changes.length) throw Error();
  } catch { return NextResponse.json({ error: "入力途中か、参加者番号・種目・組が不正です。入力を保持します" }, { status: 400, headers }); }
  try {
    const { data, error } = await operationClient(createAdminClient()).rpc("apply_ob_sheet_edits", { p_request_id: input.requestId, p_context: context as Json, p_changes: changes as Json, p_dry_run: input.dryRun });
    if (error) return NextResponse.json({ error: "重複・組の競合、またはアプリ側の変更があるため保存できません。入力を保持します" }, { status: ["40001", "P0001", "23505"].includes(error.code) ? 409 : 503, headers });
    if (!data || typeof data !== "object" || Array.isArray(data) || data.requestId !== input.requestId || data.count !== changes.length || data.dryRun !== input.dryRun) throw Error();
    if (!input.dryRun) revalidatePath(OB_PROGRAM_PATH);
    return NextResponse.json(data, { headers });
  } catch { return NextResponse.json({ error: "保存結果を確認できません。入力を保持します" }, { status: 503, headers }); }
}
