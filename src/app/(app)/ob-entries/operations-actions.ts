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
import type { Json } from "@/types/database";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorizedClient(staffOnly = false) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user || await isMemberPreviewActive()) return null;
  const roleMap = await fetchRolesByProfileIds(client, [user.id]);
  const roles = roleMap.get(user.id);
  if (!canManageObMeet(roles) && (staffOnly || !permissionsOf(roles).manageSystem)) return null;
  return operationClient(client);
}

function validData(event: string, data: MeetEventData | undefined): boolean {
  if (!data || typeof data !== "object") return false;
  // Roster-aware completeness (including absence/cancellation) is checked in the locked RPC.
  try { return typeof data.confirmed === "boolean" && JSON.stringify(data).length <= 250000 && !new MeetEvent(obEventRule(event), { ...data, confirmed: false }).validate(); }
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

export async function saveObEventOperation(input: { event: string; revision: number | null; data: MeetEventData; baseData?: MeetEventData }): Promise<{ ok: boolean; message?: string; saved?: ObEventOperation; latest?: ObEventOperation }> {
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
    return { ok: false, message: failure(result.error.message), ...(latest ? { latest } : {}) };
  }
  if (!savedOperation(result.data, input.event)) return { ok: false, message: "保存結果を確認できませんでした。画面を更新して確認してください" };
  revalidatePath(OB_PROGRAM_PATH);
  return { ok: true, saved: result.data };
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
