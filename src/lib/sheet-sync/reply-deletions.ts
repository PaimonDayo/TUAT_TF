import { OCTOBER_START, legacySyncOpen, parseSheetTransition } from "@/lib/sheet-period";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gasPost } from "./gas-client";

/** The durable receipt is kept after completion to reject stale imports. */
export async function flushReplyDeletions(admin: SupabaseClient, id?: string) {
  let query = admin.from("sheet_reply_deletions").select("*").is("processed_at", null).order("created_at").limit(id ? 1 : 5);
  if (id) query = query.eq("id", id);
  const { data, error } = await query;
  if (error) throw new Error("返信の削除待ちを取得できませんでした");
  const failures: { member: string; reason: string }[] = [];
  for (const job of data ?? []) {
    try {
      if ((job.legacy_period || job.recorded_date < OCTOBER_START) && !legacySyncOpen()) continue;
      // Unconfirmed October receipts have no verified workbook; never send to the old one.
      if (job.recorded_date >= OCTOBER_START && !job.spreadsheet_id) continue;
      const { data: record, error: recordError } = await admin.from("practice_records").select("user_id").eq("id", job.record_id).maybeSingle();
      if (recordError) throw recordError;
      if (!record) continue;
      const { data: owner, error: ownerError } = await admin.from("profiles").select("sheet_transition").eq("id", record.user_id).single();
      if (ownerError) throw ownerError;
      if (parseSheetTransition(owner?.sheet_transition)?.mode === "off") continue;
      const result = await gasPost<{ success?: boolean }>({ action: "deleteReply", memberName: job.sheet_name, spreadsheetId: job.spreadsheet_id ?? undefined,
        date: job.recorded_date, deletionId: job.id, sourceId: job.kind === "app" ? job.id : undefined,
        replyIndex: job.reply_index, expectedText: job.expected_content }, AbortSignal.timeout(20000));
      if (!result.success) throw new Error("スプレッドシートの返信を削除できませんでした");
      const saved = await admin.from("sheet_reply_deletions").update({ processed_at: new Date().toISOString() }).eq("id", job.id);
      if (saved.error) throw new Error("削除結果を保存できませんでした");
    } catch {
      failures.push({ member: job.sheet_name, reason: "返信の削除が未完了です。次回同期で再試行します" });
    }
  }
  return failures;
}
