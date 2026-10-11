import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreatedSpreadsheet } from "./google-drive";
import { pcBackupProtectionResponse } from "./pc-backup-status";

export type CreationSpec = { kind: "practice" | "meet" | "time_trial"; block: "all" | "middle_long" | "short" | "jump" | "throw"; year: number | null; month: number | null };
export type CreationReceipt = {
  outcome: "send" | "held" | "known" | "conflict" | "registered";
  attempt_id: string; state: "reserved" | "resource_known" | "registered";
  spec: CreationSpec; setup_confirmed: boolean;
  record_status: "unregistered" | "present" | "changed" | "deleted";
  sheet_id: string | null; resource: CreatedSpreadsheet | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }

export function validCreationSpec(value: unknown): value is CreationSpec {
  const spec = object(value);
  return !!spec && Object.keys(spec).length === 4 && ["practice", "meet", "time_trial"].includes(String(spec.kind))
    && ["all", "middle_long", "short", "jump", "throw"].includes(String(spec.block))
    && (spec.kind === "practice" ? Number.isInteger(spec.year) && Number(spec.year) >= 2000 && Number(spec.year) <= 2100
      && Number.isInteger(spec.month) && Number(spec.month) >= 1 && Number(spec.month) <= 12 : spec.year === null && spec.month === null);
}

export function creationReceipt(value: unknown): CreationReceipt {
  const result = object(value), resource = object(result?.resource);
  if (!result || !["send", "held", "known", "conflict", "registered"].includes(String(result.outcome))
    || typeof result.attempt_id !== "string" || !uuid.test(result.attempt_id)
    || !["reserved", "resource_known", "registered"].includes(String(result.state)) || !validCreationSpec(result.spec)
    || typeof result.setup_confirmed !== "boolean" || !["unregistered", "present", "changed", "deleted"].includes(String(result.record_status))
    || (result.sheet_id !== null && (typeof result.sheet_id !== "string" || !uuid.test(result.sheet_id)))
    || (result.state === "reserved" ? result.resource !== null || result.setup_confirmed || result.record_status !== "unregistered" || result.sheet_id !== null
      : !resource || typeof resource.spreadsheetId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(resource.spreadsheetId)
        || resource.url !== `https://docs.google.com/spreadsheets/d/${resource.spreadsheetId}/edit`)
    || (result.state !== "registered" && (result.record_status !== "unregistered" || result.sheet_id !== null))
    || (result.state === "registered" && (result.record_status === "unregistered" || (result.record_status === "present") !== (result.sheet_id !== null)))
    || (result.outcome === "send" && result.state !== "reserved")
    || (result.outcome === "registered" && (result.state !== "registered" || !result.setup_confirmed))) throw new Error("作成結果の保存状態を確認できませんでした。作り直さず、作成済みのシートを確認してください");
  return result as CreationReceipt;
}

export class GoogleSheetCreationReceiptError extends Error {
  readonly retryable = false;
  readonly protection: boolean;
  constructor(readonly phase: "create" | "setup" | "record", readonly attemptId: string,
    readonly resource: CreatedSpreadsheet | null, readonly resultUnknown: boolean, options?: ErrorOptions) {
    super(resource ? "作成済みのシートがあります。作り直さず、シートの登録状態を確認してください"
      : "作成結果を確認できませんでした。作り直さず、Google Driveで作成済みのシートを確認してください", options);
    this.protection = !!pcBackupProtectionResponse(options?.cause);
  }
}

export async function readGoogleSheetCreation(userClient: SupabaseClient): Promise<CreationReceipt | null> {
  const result = await userClient.rpc("google_sheet_creation_status");
  if (result.error) throw result.error;
  return result.data === null ? null : creationReceipt(result.data);
}

/** Unknown begin is not a dispatch permission, even if a one-time read finds a reservation. */
export async function beginGoogleSheetCreation(userClient: SupabaseClient,
  connection: { connected_at: string; refresh_token_encrypted: string }, spec: CreationSpec, fingerprint: string): Promise<CreationReceipt> {
  const attemptId = randomUUID();
  try {
    const response = await userClient.rpc("google_sheet_creation_begin", { p_attempt_id: attemptId, p_connected_at: connection.connected_at,
      p_token_sha256: createHash("sha256").update(connection.refresh_token_encrypted).digest("hex"), p_creation_fingerprint: fingerprint, p_spec: spec });
    if (response.error) throw response.error;
    const receipt = creationReceipt(response.data);
    if (receipt.outcome === "send" && receipt.attempt_id !== attemptId) throw new Error("Creation reservation mismatch");
    return receipt;
  } catch (cause) {
    try { await userClient.from("google_sheet_creation_attempts").select("attempt_id,state").eq("attempt_id", attemptId).maybeSingle(); } catch { /* The reservation still holds. */ }
    throw new GoogleSheetCreationReceiptError("create", attemptId, null, true, { cause });
  }
}

export async function rememberGoogleSheetResource(admin: SupabaseClient, receipt: CreationReceipt, profileId: string, resource: CreatedSpreadsheet): Promise<CreationReceipt> {
  try {
    const response = await admin.rpc("google_sheet_creation_resource", { p_attempt_id: receipt.attempt_id, p_profile_id: profileId, p_spreadsheet_id: resource.spreadsheetId });
    if (response.error) throw response.error;
    const known = creationReceipt(response.data);
    if (known.attempt_id !== receipt.attempt_id || known.outcome !== "known" || known.resource?.spreadsheetId !== resource.spreadsheetId
      || known.resource.url !== resource.url) throw new Error("Creation resource persistence mismatch");
    return known;
  } catch (cause) { throw new GoogleSheetCreationReceiptError("record", receipt.attempt_id, resource, false, { cause }); }
}

export async function rememberGoogleSheetSetup(admin: SupabaseClient, receipt: CreationReceipt, profileId: string, resource: CreatedSpreadsheet): Promise<CreationReceipt> {
  try {
    const response = await admin.rpc("google_sheet_creation_setup", { p_attempt_id: receipt.attempt_id, p_profile_id: profileId, p_spreadsheet_id: resource.spreadsheetId });
    if (response.error) throw response.error;
    const known = creationReceipt(response.data);
    if (known.attempt_id !== receipt.attempt_id || !known.setup_confirmed || known.resource?.spreadsheetId !== resource.spreadsheetId) throw new Error("Creation setup persistence mismatch");
    return known;
  } catch (cause) { throw new GoogleSheetCreationReceiptError("record", receipt.attempt_id, resource, false, { cause }); }
}

/** Repair only registers a previously confirmed ID. It never calls Google. */
export async function registerGoogleSheetResource(userClient: SupabaseClient, attemptId: string): Promise<CreationReceipt> {
  if (!uuid.test(attemptId)) throw new Error("シートの登録条件が不正です");
  const response = await userClient.rpc("google_sheet_creation_register", { p_attempt_id: attemptId });
  if (response.error) throw response.error;
  const receipt = creationReceipt(response.data);
  if (receipt.attempt_id !== attemptId || receipt.state !== "registered") throw new Error("シートの登録結果を確認できませんでした");
  return receipt;
}
