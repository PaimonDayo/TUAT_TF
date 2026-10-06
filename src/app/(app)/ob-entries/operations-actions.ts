"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds, isMemberPreviewActive } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { operationClient, type ObDayEntryInput } from "@/lib/ob-operations-db";
import { OB_ENTRY_EVENTS, validEntryDelete, validGuestEntry } from "@/lib/ob-entry-edit";
import { OB_PROGRAM_PATH, canManageObMeet } from "@/lib/ob-meet";
import { MeetEvent, type MeetEventData } from "@/lib/meet-operations";
import { obEventRule, type ObEventOperation } from "@/lib/ob-operations";
import { obOperationHasChanges, obOperationSaveMatches } from "@/lib/ob-operation-draft";
import { obSourceDivision, type ObMixedInput } from "@/lib/ob-mixed-operations";
import type { Json } from "@/types/database";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorizedClient(staffOnly = false) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user || await isMemberPreviewActive()) return null;
  const roleMap = await fetchRolesByProfileIds(client, [user.id]);
  const roles = roleMap.get(user.id);
  if (!canManageObMeet(roles) && (staffOnly || !permissionsOf(roles).manageSystem)) {
    if (staffOnly) return null;
    const { data: profile, error } = await client.from("profiles").select("id,approved,status").eq("id", user.id).maybeSingle();
    if (error || !profile || profile.id !== user.id || !profile.approved || profile.status !== "active") return null;
  }
  return operationClient(client);
}

function validData(event: string, data: MeetEventData | undefined): boolean {
  if (!data || typeof data !== "object") return false;
  // Roster-aware completeness (including absence/cancellation) is checked in the locked RPC.
  try { return typeof data.confirmed === "boolean" && JSON.stringify(data).length <= 250000 && !new MeetEvent(obEventRule(event), { ...data, confirmed: false }, { maxOrder: 600 }).validate(); }
  catch { return false; }
}

function savedOperation(value: unknown, event: string): value is ObEventOperation {
  if (!value || typeof value !== "object") return false;
  const operation = value as ObEventOperation;
  return operation.meet_key === "ob-2026" && operation.event_name === event
    && Number.isSafeInteger(operation.revision) && operation.revision >= 0
    && typeof operation.updated_at === "string" && validData(event, operation.data);
}

function failure(message: string): string {
  if (message.includes("operation_conflict")) return "同じ内容が他の端末でも変更されています。変更箇所を確認してください";
  if (message.includes("operation_absent") || message.includes("entry_absent")) return "欠席になっています。出場させる場合は先に欠席を取り消してください";
  if (message.includes("operation_started")) return "この組は記録の入力が始まっています。別の組を選ぶか、未配置で登録してください";
  if (message.includes("operation_confirmed")) return "結果が確定した種目には追加できません。種目の確定を解除してください";
  if (message.includes("entry_duplicate")) return "同じ名前の登録があります。登録済みの人から選んでください";
  if (message.includes("entry_conflict")) return "登録が他の端末で更新されています。画面を更新して確認してください";
  if (message.includes("operation_roster")) return "出場登録が変更されています。画面を更新して確認してください";
  if (message.includes("entry_division")) return "登録済みの区分と種目が一致していません";
  if (message.includes("operation_request")) return "この追加操作は既に処理されています。画面を更新して確認してください";
  if (message.includes("operation_existing")) return "この人は既に組・結果が登録されています。種目の画面で変更してください";
  if (message.includes("operation_position")) return "同じ組のレーン・試技順が重複しています。配置を確認してください";
  if (message.includes("operation_incomplete")) return "未記録の出場者がいます。入力途中のまま保存するか、記録・欠場を確認してください";
  return "保存できませんでした。入力内容を確認して再度保存してください";
}

type SaveOperationInput = { event: string; revision: number | null; data: MeetEventData; baseData?: MeetEventData };

function matchesAttempt(input: SaveOperationInput, saved: ObEventOperation): boolean {
  return saved.revision > (input.revision ?? -1)
    && (!input.baseData || obOperationSaveMatches(input.baseData, input.data, saved.data, obSourceDivision(input.event)));
}

/** An uncertain save can only be checked by reading the same meet/event as the verified operator. */
export async function checkObEventOperation(input: SaveOperationInput): Promise<{ ok: boolean; message?: string; saved?: ObEventOperation }> {
  if (!input || !OB_ENTRY_EVENTS.includes(input.event) || !input.baseData
    || !(input.revision === null || Number.isSafeInteger(input.revision) && input.revision >= 0)
    || !validData(input.event, input.data) || !validData(input.event, input.baseData)) return { ok: false, message: "確認する保存内容を確認してください" };
  try {
    const client = await authorizedClient();
    if (!client) return { ok: false, message: "ログイン状態と記録入力の権限を確認してください。入力は残っています" };
    const { data, error } = await client.from("ob_event_operations")
      .select("meet_key,event_name,revision,data,updated_at").eq("meet_key", "ob-2026").eq("event_name", input.event).maybeSingle();
    if (error) return { ok: false, message: "保存結果を取得できませんでした。入力は残っています。接続後にもう一度確認してください" };
    if (!savedOperation(data, input.event) || !matchesAttempt(input, data)) return { ok: false, message: "送信した変更の保存を確認できませんでした。入力は残っています。もう一度結果を確認してください" };
    return { ok: true, saved: data };
  } catch {
    return { ok: false, message: "保存結果を取得できませんでした。入力は残っています。接続後にもう一度確認してください" };
  }
}

export async function saveObEventOperation(input: SaveOperationInput): Promise<{ ok: boolean; message?: string; saved?: ObEventOperation; latest?: ObEventOperation; uncertain?: boolean }> {
  if (!input || !OB_ENTRY_EVENTS.includes(input.event)
    || !(input.revision === null || Number.isSafeInteger(input.revision) && input.revision >= 0)
    || !validData(input.event, input.data) || (input.baseData !== undefined && !validData(input.event, input.baseData))) return { ok: false, message: "入力内容を確認してください" };
  const client = await authorizedClient();
  if (!client) return { ok: false, message: "大会運営の権限がありません" };
  const result = await client.rpc("save_ob_event_operation_checked", {
    p_event: input.event, p_revision: input.revision, p_data: input.data as unknown as Json,
    p_base_data: (input.baseData ?? null) as unknown as Json,
  });
  if (result.error) {
    let latest: ObEventOperation | undefined;
    if (result.error.message.includes("operation_conflict")) {
      try { const value: unknown = JSON.parse(result.error.details ?? "null"); if (savedOperation(value, input.event)) latest = value; } catch { /* No unverified data is returned. */ }
    }
    // A SQLSTATE establishes transaction rollback; a transport response does not.
    const uncertain = !result.error.code || !/^[A-Z0-9]{5}$/.test(result.error.code);
    return { ok: false, message: failure(result.error.message), ...(latest ? { latest } : {}), ...(uncertain ? { uncertain: true } : {}) };
  }
  if (!savedOperation(result.data, input.event) || !matchesAttempt(input, result.data)) return { ok: false, uncertain: true, message: "保存結果を確認できませんでした。入力は残っています。結果を確認してください" };
  revalidatePath(OB_PROGRAM_PATH);
  return { ok: true, saved: result.data };
}

type FamilyOperationInput = { family: string; operations: ObMixedInput[] };
type FamilyOperationResult = { ok: boolean; message?: string; saved?: ObEventOperation[]; latest?: ObEventOperation[]; uncertain?: boolean };

function validFamilyInput(input: FamilyOperationInput): boolean {
  if (!input || typeof input.family !== "string" || !Array.isArray(input.operations) || input.operations.length !== 2
    || !OB_ENTRY_EVENTS.includes(`男子${input.family}`) || !OB_ENTRY_EVENTS.includes(`女子${input.family}`)) return false;
  const events = new Set(input.operations.map(operation => operation?.event));
  return events.size === 2 && events.has(`男子${input.family}`) && events.has(`女子${input.family}`)
    && input.operations.every(operation => operation && (operation.revision === null || Number.isSafeInteger(operation.revision) && operation.revision >= 0)
      && validData(operation.event, operation.data) && validData(operation.event, operation.baseData));
}
function familySaved(value: unknown, input: FamilyOperationInput): value is ObEventOperation[] {
  if (!Array.isArray(value) || new Set(value.map(op => op?.event_name)).size !== value.length) return false;
  if (!value.every(op => input.operations.some(request => savedOperation(op, request.event)))) return false;
  return input.operations.every(request => {
    const saved = value.find(op => op.event_name === request.event);
    const changed = obOperationHasChanges(request.baseData, request.data, obSourceDivision(request.event));
    if (!saved) return !changed && request.revision === null && !request.data.participants.length;
    return saved.revision >= (request.revision ?? -1) && (!changed || saved.revision > (request.revision ?? -1))
      && obOperationSaveMatches(request.baseData, request.data, saved.data, obSourceDivision(request.event));
  });
}
async function readFamily(client: Awaited<ReturnType<typeof authorizedClient>>, input: FamilyOperationInput) {
  if (!client) return null;
  const result = await client.from("ob_event_operations").select("meet_key,event_name,revision,data,updated_at")
    .eq("meet_key", "ob-2026").in("event_name", input.operations.map(operation => operation.event));
  if (result.error || !Array.isArray(result.data) || !result.data.every(op => input.operations.some(request => savedOperation(op, request.event)))) return null;
  return result.data;
}

/** One read proves the frozen changes in both registration events; no retry writes. */
export async function checkObFamilyOperation(input: FamilyOperationInput): Promise<FamilyOperationResult> {
  if (!validFamilyInput(input)) return { ok: false, message: "確認する保存内容を確認してください" };
  try {
    const client = await authorizedClient(true);
    if (!client) return { ok: false, message: "大会担当者の権限がありません。入力は残っています" };
    const saved = await readFamily(client, input);
    if (!saved) return { ok: false, message: "保存結果を取得できませんでした。入力は残っています。接続後にもう一度確認してください" };
    if (!familySaved(saved, input)) return { ok: false, message: "男女両方の保存を確認できませんでした。入力は残っています。もう一度結果を確認してください" };
    return { ok: true, saved };
  } catch { return { ok: false, message: "保存結果を取得できませんでした。入力は残っています。接続後にもう一度確認してください" }; }
}

export async function saveObFamilyOperation(input: FamilyOperationInput): Promise<FamilyOperationResult> {
  if (!validFamilyInput(input)) return { ok: false, message: "入力内容を確認してください" };
  const client = await authorizedClient(true);
  if (!client) return { ok: false, message: "大会担当者の権限がありません" };
  if (!input.operations.some(request => obOperationHasChanges(request.baseData, request.data, obSourceDivision(request.event)))) return { ok: false, message: "変更はありません" };
  const result = await client.rpc("save_ob_family_operation_checked", { p_family: input.family, p_operations: input.operations as unknown as Json });
  if (result.error) {
    const uncertain = !result.error.code || !/^[A-Z0-9]{5}$/.test(result.error.code);
    let latest: ObEventOperation[] | null = null;
    if (result.error.message.includes("operation_conflict")) {
      try { latest = await readFamily(client, input); } catch { /* A review read failure does not change a proven rollback. */ }
    }
    return { ok: false, message: failure(result.error.message), ...(latest ? { latest } : {}), ...(uncertain ? { uncertain: true } : {}) };
  }
  if (!familySaved(result.data?.operations, input)) return { ok: false, uncertain: true, message: "保存結果を確認できませんでした。入力は残っています。結果を確認してください" };
  revalidatePath(OB_PROGRAM_PATH);
  return { ok: true, saved: result.data.operations };
}

export async function setObAttendance(input: { entryId: string; revision: number; absent: boolean }): Promise<{ ok: boolean; message?: string; entryId?: string; revision?: number; absent?: boolean }> {
  if (!validEntryDelete(input) || typeof input.absent !== "boolean") return { ok: false, message: "入力内容を確認してください" };
  const client = await authorizedClient(true);
  if (!client) return { ok: false, message: "大会担当者の権限がありません" };
  const result = await client.rpc("set_ob_attendance", { p_entry_id: input.entryId, p_revision: input.revision, p_absent: input.absent });
  if (result.error) return { ok: false, message: failure(result.error.message) };
  const saved = result.data;
  if (!saved || saved.entryId !== input.entryId || saved.absent !== input.absent || !Number.isSafeInteger(saved.revision) || saved.revision < input.revision) return { ok: false, message: "保存結果を確認できませんでした。画面を更新して確認してください" };
  revalidatePath(OB_PROGRAM_PATH);
  revalidatePath("/home");
  return { ok: true, ...saved };
}

export async function addObDayEntry(input: ObDayEntryInput): Promise<{ ok: boolean; message?: string; entryId?: string; saved?: ObEventOperation; stale?: boolean }> {
  if (!input || !uuid.test(input.operationId) || !OB_ENTRY_EVENTS.includes(input.event)
    || (input.group != null && (!Number.isSafeInteger(input.group) || input.group < 1 || input.group > 99))
    || (input.entryId != null
      ? !validEntryDelete({ entryId: input.entryId, revision: input.revision! }) || input.name != null || input.grade != null
      : input.revision != null || !validGuestEntry({ name: input.name!, grade: input.grade!, events: [input.event], marks: {}, partyStatus: "未回答" }))) return { ok: false, message: "入力内容を確認してください" };
  const client = await authorizedClient(true);
  if (!client) return { ok: false, message: "大会担当者の権限がありません" };
  const result = await client.rpc("add_ob_day_entry", {
    p_request_id: input.operationId, p_event: input.event, p_entry_id: input.entryId ?? null,
    p_revision: input.revision ?? null, p_name: input.name?.trim() ?? null,
    p_grade: input.grade ?? null, p_group: input.group ?? null,
  });
  if (result.error) return { ok: false, message: failure(result.error.message), ...(result.error.message === "entry_conflict" ? { stale: true } : {}) };
  const saved = result.data;
  if (!saved || !uuid.test(saved.entryId) || !savedOperation(saved.saved, input.event)) return { ok: false, message: "保存結果を確認できませんでした。再試行するか、画面を更新して確認してください" };
  revalidatePath(OB_PROGRAM_PATH);
  revalidatePath("/home");
  return { ok: true, entryId: saved.entryId, saved: saved.saved };
}
