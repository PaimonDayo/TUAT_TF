import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/types/database";
import type { RecordFieldDef } from "@/types";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import { gasPost } from "./gas-client";

const profileKeys = ["sheet_name", "record_fields", "sheet_transition", "sheet_header_signature", "record_source"] as const;
export type PushProfileSnapshot = Record<(typeof profileKeys)[number], Json>;
export type PushMarkerStatus = "pending" | "applied" | "superseded" | "partial";
type BeginOutcome = "send" | "blocked" | "stale" | "confirmed" | "completed";
export type PushReceiptResult = { outcome: "confirmed" | "completed"; marker_status: PushMarkerStatus };
export type ActivePushReceipt = {
  attempt_id: string;
  state: "reserved" | "confirmed";
  profile_id: string;
  recorded_date: string;
  record_id: string | null;
  target_slot: string;
};

/** Keep the selected DB values, including nulls, rather than normalized routing values. */
export function pushProfileSnapshot(profile: Record<string, unknown>): PushProfileSnapshot {
  const snapshot: Record<string, Json> = {};
  for (const key of profileKeys) {
    if (!Object.hasOwn(profile, key) || profile[key] === undefined) {
      throw new Error("シート設定を確認できませんでした。送信を保留しました");
    }
    snapshot[key] = profile[key] as Json;
  }
  return snapshot as PushProfileSnapshot;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const json = JSON.stringify(value);
    if (json === undefined || (typeof value === "number" && !Number.isFinite(value))) throw new Error("送信内容を確認できませんでした");
    return json;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

/** Only hashes are persisted; endpoint credentials and cell contents stay out of the receipt. */
export function pushFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const markerStatuses = new Set<unknown>(["pending", "applied", "superseded", "partial"]);
function receiptObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Unresolved receipts also protect deleted or changed records against CSV resurrection. */
export async function listActivePushReceipts(admin: SupabaseClient): Promise<ActivePushReceipt[]> {
  const rows = await fetchAllPages<ActivePushReceipt>(async (from, to) => {
    const page = await admin.from("sheet_push_attempts")
    .select("attempt_id,state,profile_id,recorded_date,record_id,target_slot")
    .in("state", ["reserved", "confirmed"]).order("attempt_id", { ascending: true }).range(from, to);
    if (page.error || !Array.isArray(page.data)) throw new Error("未確認の送信状態を取得できませんでした。取り込みと送信を保留しました");
    return { data: page.data as ActivePushReceipt[], error: null };
  });
  for (const row of rows) {
    if (!uuid.test(row.attempt_id) || !uuid.test(row.profile_id) || (row.record_id !== null && !uuid.test(row.record_id))
      || !/^\d{4}-\d{2}-\d{2}$/.test(row.recorded_date) || !hash.test(row.target_slot)
      || !["reserved", "confirmed"].includes(row.state)) {
      throw new Error("未確認の送信状態を取得できませんでした。取り込みと送信を保留しました");
    }
  }
  return rows;
}

export type PushAttemptInput = {
  kind: "record" | "clear";
  recordId: string | null;
  profileId: string;
  date: string;
  expectedVersion: string;
  expectedProfile: PushProfileSnapshot;
  targetSlot: string;
  targetFingerprint: string;
  payloadSha256: string;
};

export class SheetPushReceiptError extends Error {
  readonly retryable = false;
  constructor(
    readonly code: "SHEET_PUSH_BLOCKED" | "SHEET_PUSH_STALE" | "SHEET_PUSH_BEGIN_UNCONFIRMED" | "SHEET_SENT_MARKER_UNCONFIRMED" | "SHEET_PUSH_PARTIAL" | "SHEET_WRITE_RESULT_UNKNOWN",
    message: string,
    readonly attemptId: string,
    readonly externallySent: boolean | "unknown",
    readonly resultUnknown = false,
    cause?: unknown,
  ) { super(message, { cause }); }
}

/** An unknown begin may have committed: read its ID once, but never send from that read. */
async function uncertainBegin(admin: SupabaseClient, attemptId: string, cause?: unknown): Promise<never> {
  try { await admin.from("sheet_push_attempts").select("attempt_id,state,marker_status").eq("attempt_id", attemptId).maybeSingle(); } catch { /* Keep the reservation even when its read also fails. */ }
  throw new SheetPushReceiptError("SHEET_PUSH_BEGIN_UNCONFIRMED", "送信の準備を確認できませんでした。再送せず、送信先を確認してください。", attemptId, false, true, cause);
}

export async function beginPushAttempt(admin: SupabaseClient, input: PushAttemptInput): Promise<{ attemptId: string; outcome: BeginOutcome; markerStatus: PushMarkerStatus }> {
  if (!input.expectedVersion || !Number.isFinite(Date.parse(input.expectedVersion))) throw new Error("記録の更新時刻を確認できませんでした。送信を保留しました");
  const attemptId = randomUUID();
  let response;
  try {
    response = await admin.rpc("sheet_push_begin", {
      p_attempt_id: attemptId, p_kind: input.kind, p_record_id: input.recordId,
      p_profile_id: input.profileId, p_recorded_date: input.date, p_expected_version: input.expectedVersion,
      p_expected_profile: input.expectedProfile, p_target_slot: input.targetSlot,
      p_target_fingerprint: input.targetFingerprint, p_payload_sha256: input.payloadSha256,
    });
  } catch (error) { return uncertainBegin(admin, attemptId, error); }
  const result = receiptObject(response.data);
  if (response.error || !result || !["send", "blocked", "stale", "confirmed", "completed"].includes(String(result.outcome))
    || typeof result.attempt_id !== "string" || !uuid.test(result.attempt_id) || !markerStatuses.has(result.marker_status)
    || (result.outcome === "send" && (result.attempt_id !== attemptId || result.marker_status !== "pending"))
    || (result.outcome === "confirmed" && result.marker_status !== "partial")
    || (result.outcome === "completed" && !["applied", "superseded"].includes(String(result.marker_status)))) return uncertainBegin(admin, attemptId, response.error);
  return { attemptId: result.attempt_id, outcome: result.outcome as BeginOutcome, markerStatus: result.marker_status as PushMarkerStatus };
}

export async function finishPushAttempt(admin: SupabaseClient, attemptId: string, input: PushAttemptInput, providerComplete: boolean): Promise<PushReceiptResult> {
  let response;
  try {
    response = await admin.rpc("sheet_push_finish", { p_attempt_id: attemptId,
      p_target_fingerprint: input.targetFingerprint, p_payload_sha256: input.payloadSha256,
      p_provider_complete: providerComplete });
  } catch (error) {
    throw new SheetPushReceiptError("SHEET_SENT_MARKER_UNCONFIRMED", "送信結果の保存を確認できませんでした。再送せず、送信先を確認してください。", attemptId, true, false, error);
  }
  const result = receiptObject(response.data);
  if (response.error || !result || !((result.outcome === "confirmed" && result.marker_status === "partial")
    || (result.outcome === "completed" && ["applied", "superseded"].includes(String(result.marker_status))))) {
    throw new SheetPushReceiptError("SHEET_SENT_MARKER_UNCONFIRMED", "送信結果の保存を確認できませんでした。再送せず、送信先を確認してください。", attemptId, true, false, response.error);
  }
  return { outcome: result.outcome as PushReceiptResult["outcome"], marker_status: result.marker_status as PushMarkerStatus };
}

export type WriteCellsTarget = {
  sheetName: string;
  spreadsheetId?: string;
  fields: RecordFieldDef[];
  columns: { index: number; label: string }[];
};

function workbookIdentity(spreadsheetId?: string): string {
  if (spreadsheetId) return spreadsheetId;
  const endpoint = process.env.SHEET_SYNC_GAS_URL;
  if (!endpoint) throw new Error("スプレッドシートの送信先を確認できませんでした");
  // Legacy GAS resolves its own default. Its actual workbook ID still needs
  // independent verification before cutover; this sentinel does not prove it.
  return `gas-default:${pushFingerprint(endpoint)}`;
}

export function writeCellsTargetSlot(sheetName: string, date: string, spreadsheetId?: string): string {
  return pushFingerprint({ workbook: workbookIdentity(spreadsheetId), member: sheetName.normalize("NFC").trim(), date });
}

export function writeCellsIdentity(target: WriteCellsTarget, date: string, cells: Record<string, string | number>) {
  const endpoint = process.env.SHEET_SYNC_GAS_URL;
  if (!endpoint) throw new Error("スプレッドシートの送信先を確認できませんでした");
  const workbook = workbookIdentity(target.spreadsheetId);
  return {
    targetSlot: writeCellsTargetSlot(target.sheetName, date, target.spreadsheetId),
    targetFingerprint: pushFingerprint({ endpoint, workbook, member: target.sheetName, fields: target.fields, columns: target.columns }),
    payloadSha256: pushFingerprint({ action: "writeCells", ...(target.spreadsheetId ? { spreadsheetId: target.spreadsheetId } : {}), memberName: target.sheetName, date, cells }),
  };
}

/** Both immediate and scheduled writeCells use this single one-dispatch boundary. */
export async function writeCellsWithReceipt(admin: SupabaseClient, input: Omit<PushAttemptInput, "targetSlot" | "targetFingerprint" | "payloadSha256">,
  target: WriteCellsTarget, cells: Record<string, string | number>, unmapped: string[] = []): Promise<{ action: "created" | "updated"; unmapped: string[]; receipt: PushReceiptResult }> {
  const binding: PushAttemptInput = { ...input, ...writeCellsIdentity(target, input.date, cells) };
  const begin = await beginPushAttempt(admin, binding);
  if (begin.outcome === "completed") {
    if (begin.markerStatus !== "applied" && begin.markerStatus !== "superseded") return uncertainBegin(admin, begin.attemptId);
    return { action: "updated", unmapped: [], receipt: { outcome: "completed", marker_status: begin.markerStatus } };
  }
  if (begin.outcome !== "send") {
    throw new SheetPushReceiptError(begin.outcome === "stale" ? "SHEET_PUSH_STALE" : "SHEET_PUSH_BLOCKED",
      begin.outcome === "stale" ? "記録またはシート設定が変わりました。最新の内容を確認してください。" : "前の送信結果を確認できていません。再送せず、送信先を確認してください。",
      begin.attemptId, begin.outcome === "stale" ? false : "unknown", begin.outcome !== "stale");
  }
  let result: { success?: boolean; action?: "created" | "updated"; unmapped?: string[]; protectedHeaders?: string[] };
  try {
    result = await gasPost({ action: "writeCells", ...(target.spreadsheetId ? { spreadsheetId: target.spreadsheetId } : {}),
      memberName: target.sheetName, date: input.date, cells });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "PC_BACKUP_UNAVAILABLE") {
      throw new SheetPushReceiptError("SHEET_PUSH_BLOCKED", "送信前の保護により書き込みを保留しました。送信先を確認してください。", begin.attemptId, false, false, error);
    }
    throw new SheetPushReceiptError("SHEET_WRITE_RESULT_UNKNOWN", "スプレッドシートへの送信結果を確認できませんでした。再送せず、送信先を確認してください。", begin.attemptId, "unknown", true, error);
  }
  if (!result || typeof result !== "object" || Array.isArray(result) || result.success !== true
    || !["created", "updated"].includes(String(result.action))
    || [result.unmapped, result.protectedHeaders].some(values => values !== undefined && (!Array.isArray(values) || !values.every(value => typeof value === "string")))) {
    throw new SheetPushReceiptError("SHEET_WRITE_RESULT_UNKNOWN", "スプレッドシートへの送信結果を確認できませんでした。再送せず、送信先を確認してください。", begin.attemptId, "unknown", true);
  }
  const missing = [...unmapped, ...(result.unmapped ?? []), ...(result.protectedHeaders ?? [])];
  const receipt = await finishPushAttempt(admin, begin.attemptId, binding, missing.length === 0);
  return { action: result.action as "created" | "updated", unmapped: missing, receipt };
}

/** No-provider resolution must still lock the queue and check active receipts. */
export async function resolvePendingClear(admin: SupabaseClient, input: { profileId: string; date: string; expectedVersion: string; expectedProfile: PushProfileSnapshot; targetSlot: string }): Promise<void> {
  if (!input.expectedVersion || !Number.isFinite(Date.parse(input.expectedVersion))) throw new Error("削除予定の状態を確認できませんでした");
  const response = await admin.rpc("sheet_clear_resolve", { p_profile_id: input.profileId, p_recorded_date: input.date,
    p_expected_version: input.expectedVersion, p_expected_profile: input.expectedProfile, p_target_slot: input.targetSlot });
  const result = receiptObject(response.data);
  if (response.error || !result || result.outcome !== "resolved") {
    throw new SheetPushReceiptError(result?.outcome === "stale" ? "SHEET_PUSH_STALE" : "SHEET_PUSH_BLOCKED",
      "削除予定の状態を確認できませんでした。送信先を確認してください。", "", false, false, response.error);
  }
}
