import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { MEMBER_PREVIEW_COOKIE } from "@/lib/member-preview";
import { recordFieldsFromJson, recordFieldsToJson } from "@/lib/profile-normalize";
import { OCTOBER_SHEET_ID, needsSheetSetupConfirmation, parseSheetTransition } from "@/lib/sheet-period";
import { fetchPublicMember, fetchPublicSheetMembers } from "@/lib/sheet-public-csv";
import {
  buildSheetRecordFields, isFixedSheetColumn, memoHeaderCandidates,
  relevantSheetHeaderSignature, timelineFieldLimit, type SheetHeaderColumn,
} from "@/lib/sheet-field-config";
import type { RecordFieldDef } from "@/types";
import type { Database, Json } from "@/types/database";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
type Context = { params: Promise<{ id: string }> };
type Client = Awaited<ReturnType<typeof createClient>>;
type Target = Pick<Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "blocks" | "sheet_name" | "record_fields" | "record_fields_version" | "sheet_header_signature" | "sheet_transition" | "record_source">;

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function authorize(): Promise<Client | Response> {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return reply({ error: "認証が必要です" }, 401);
  const roles = await fetchRolesByProfileIds(client, [user.id]);
  if (!permissionsOf(roles.get(user.id)).manageSystem || (await cookies()).get(MEMBER_PREVIEW_COOKIE)?.value === "1") {
    return reply({ error: "システム管理権限が必要です" }, 403);
  }
  return client;
}

async function readTarget(client: Client, id: string): Promise<Target> {
  const { data, error } = await client.from("profiles")
    .select("id,blocks,sheet_name,record_fields,record_fields_version,sheet_header_signature,sheet_transition,record_source")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("設定を取得できませんでした");
  if (!data) throw new RequestError(404, "部員が見つかりません");
  return data;
}

function expectedState(target: Target): Json {
  return {
    id: target.id, blocks: target.blocks, sheet_name: target.sheet_name, record_fields: target.record_fields,
    record_fields_version: target.record_fields_version, sheet_header_signature: target.sheet_header_signature,
    sheet_transition: target.sheet_transition, record_source: target.record_source,
  };
}

function revision(target: Target): string {
  return createHash("sha256").update(JSON.stringify(expectedState(target))).digest("hex");
}

async function readHeader(target: Target, sheetName: string) {
  const member = await fetchPublicMember(sheetName, { spreadsheetId: OCTOBER_SHEET_ID });
  const columns = member.columns ?? member.header.map((label, index) => ({ index, label }));
  if (!columns.some((column) => column.label.replace(/\s/g, "") === "日付")) {
    throw new RequestError(502, "シートの日付列を確認できませんでした");
  }
  return {
    sheetName: member.name,
    columns,
    signature: relevantSheetHeaderSignature(columns, recordFieldsFromJson(target.record_fields), target.blocks.includes("middle_long")),
    memoCandidates: memoHeaderCandidates(columns).map((column) => column.index),
  };
}

const FIELD_KEYS = new Set(["key", "label", "type", "hidden", "sourceHeader", "sourceColumn", "showInTimeline"]);
function validateFields(input: unknown, columns: SheetHeaderColumn[], isMiddleLong: boolean): RecordFieldDef[] {
  if (!Array.isArray(input) || input.length > columns.length || input.some((field) =>
    !field || typeof field !== "object" || Array.isArray(field)
    || Object.keys(field).some((key) => !FIELD_KEYS.has(key))
    || typeof field.key !== "string" || typeof field.label !== "string"
    || (field.type !== "text" && field.type !== "number")
    || typeof field.sourceHeader !== "string" || !Number.isInteger(field.sourceColumn) || field.sourceColumn < 0
    || typeof field.showInTimeline !== "boolean"
    || (field.hidden !== undefined && typeof field.hidden !== "boolean"))) {
    throw new RequestError(400, "表示項目を確認してください");
  }
  const fields = recordFieldsFromJson(input as Json);
  if (new Set(fields.map((field) => field.sourceColumn)).size !== fields.length) {
    throw new RequestError(400, "同じ列を複数の項目に設定できません");
  }
  if (fields.some((field) => !columns.some((column) => column.index === field.sourceColumn && column.label === field.sourceHeader))) {
    throw new RequestError(409, "シートの見出しが変わりました。再読み込みしてください");
  }
  if (fields.filter((field) => field.showInTimeline && !isFixedSheetColumn(field.sourceHeader!, isMiddleLong)).length > timelineFieldLimit(isMiddleLong)) {
    throw new RequestError(400, "タイムラインの表示項目が上限を超えています");
  }
  const canonical = buildSheetRecordFields({
    columns,
    selectedColumns: fields.filter((field) => !field.hidden).map((field) => field.sourceColumn!),
    timelineColumns: fields.filter((field) => field.showInTimeline).map((field) => field.sourceColumn!),
    types: Object.fromEntries(fields.filter((field) => !isFixedSheetColumn(field.sourceHeader!, isMiddleLong))
      .map((field) => [field.sourceColumn!, field.type])),
    isMiddleLong,
    memoColumn: memoHeaderCandidates(columns)[0]?.index ?? null,
  });
  if (JSON.stringify(recordFieldsToJson(fields)) !== JSON.stringify(recordFieldsToJson(canonical))) {
    throw new RequestError(400, "シートの項目を確認してください。標準項目は外せません");
  }
  return canonical;
}

export async function GET(request: Request, context: Context) {
  try {
    const access = await authorize();
    if (access instanceof Response) return access;
    const { id } = await context.params;
    const target = await readTarget(access, id);
    const params = new URL(request.url).searchParams;
    const view = params.get("view");
    if (view === "settings") return reply({
      revision: revision(target), fields: recordFieldsFromJson(target.record_fields), sheetName: target.sheet_name,
      mode: parseSheetTransition(target.sheet_transition)?.mode ?? null, signature: target.sheet_header_signature,
      isMiddleLong: target.blocks.includes("middle_long"),
    });
    if (view === "members") return reply({ members: await fetchPublicSheetMembers(OCTOBER_SHEET_ID) });
    const selectedName = params.get("sheetName");
    if (selectedName === null) {
      const transition = parseSheetTransition(target.sheet_transition);
      if (!transition || needsSheetSetupConfirmation(transition) || transition.mode === "off" || !target.sheet_name?.trim()) {
        throw new RequestError(409, "連携シートと入力方法を確認してください");
      }
    } else if (!selectedName.trim()) throw new RequestError(400, "連携シートを選択してください");
    const header = await readHeader(target, selectedName ?? target.sheet_name!);
    return reply({ revision: revision(target), fields: recordFieldsFromJson(target.record_fields), header, isMiddleLong: target.blocks.includes("middle_long") });
  } catch (error) {
    if (error instanceof RequestError) return reply({ error: error.message }, error.status);
    return reply({ error: "表示項目を取得できませんでした。再読み込みしてください" }, 503);
  }
}

export async function POST(request: Request, context: Context) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "管理画面から操作してください" }, 403);
  }
  let saving = false;
  try {
    const access = await authorize();
    if (access instanceof Response) return access;
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision)
      || !["sheet", "app_only", "off"].includes(body.mode)) {
      return reply({ error: "表示項目を確認してください" }, 400);
    }
    const before = await readTarget(access, id);
    if (revision(before) !== body.revision) return reply({ error: "設定が変更されています。再読み込みしてください" }, 409);
    let fields: RecordFieldDef[] = [];
    let signature = "";
    let sheetName = "";
    if (body.mode !== "off") {
      if (typeof body.sheetName !== "string" || !body.sheetName.trim() || typeof body.signature !== "string" || !Array.isArray(body.fields)) {
        return reply({ error: "連携シートと表示項目を確認してください" }, 400);
      }
      const header = await readHeader(before, body.sheetName);
      const isMiddleLong = before.blocks.includes("middle_long");
      fields = validateFields(body.fields, header.columns, isMiddleLong);
      signature = relevantSheetHeaderSignature(header.columns, fields, isMiddleLong);
      if (signature !== body.signature) return reply({ error: "シートの見出しが変わりました。再読み込みしてください" }, 409);
      sheetName = header.sheetName;
    }
    saving = true;
    const { data, error } = await access.rpc("admin_save_member_sheet_setup", {
      p_profile_id: id, p_expected: expectedState(before), p_sheet_name: sheetName,
      p_fields: recordFieldsToJson(fields), p_signature: signature, p_mode: body.mode,
    });
    if (error?.code === "PT409") return reply({ error: "設定が変更されています。再読み込みしてください" }, 409);
    if (error?.code === "P0002") return reply({ error: "部員が見つかりません" }, 404);
    if (error?.code === "PT503") return reply({ error: "PC停止中は変更できません。復帰後にお試しください", unchanged: true }, 503);
    if (error || data === null) return reply({ error: "保存結果を確認できません。再読み込みしてください", uncertain: true }, 503);
    if (data.length !== 1 || data[0].id !== id || !Number.isInteger(data[0].record_fields_version)) {
      return reply({ error: "保存結果を確認できません。再読み込みしてください", uncertain: true }, 503);
    }
    return reply({ ok: true, version: data[0].record_fields_version });
  } catch (error) {
    if (!saving && error instanceof RequestError) return reply({ error: error.message }, error.status);
    return reply(saving
      ? { error: "保存結果を確認できません。再読み込みしてください", uncertain: true }
      : { error: "表示項目を確認できませんでした。再読み込みしてください" }, 503);
  }
}
