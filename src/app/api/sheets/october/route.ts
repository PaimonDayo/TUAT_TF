import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { OCTOBER_SHEET_ID } from "@/lib/sheet-period";
import { fetchPublicMember, fetchPublicSheetMembers } from "@/lib/sheet-public-csv";
import { recordFieldsFromJson, recordFieldsToJson } from "@/lib/profile-normalize";
import { isFixedSheetColumn, memoHeaderCandidates, relevantSheetHeaderSignature, timelineFieldLimit } from "@/lib/sheet-field-config";
import type { Json } from "@/types/database";

async function access() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "認証が必要です" }, { status: 401 }) };
  const { data: allowed, error } = await client.rpc("can_manage_system");
  if (error || !allowed) return { error: NextResponse.json({ error: "システムロール限定です" }, { status: 403 }) };
  const { data: profile, error: profileError } = await client.from("profiles").select("blocks,record_fields").eq("id", user.id).single();
  if (profileError) return { error: NextResponse.json({ error: "設定を取得できませんでした" }, { status: 503 }) };
  return { client, profile };
}

export async function GET(request: Request) {
  const auth = await access();
  if (auth.error) return auth.error;
  try {
    const name = new URL(request.url).searchParams.get("sheetName");
    if (!name) return NextResponse.json({ members: await fetchPublicSheetMembers(OCTOBER_SHEET_ID) });
    const member = await fetchPublicMember(name, { spreadsheetId: OCTOBER_SHEET_ID });
    const columns = member.columns ?? [];
    if (!columns.some(c => c.label.replace(/\s/g, "") === "日付")) throw new Error("日付列が見つかりません");
    return NextResponse.json({ sheetName: member.name, columns,
      signature: relevantSheetHeaderSignature(columns, recordFieldsFromJson(auth.profile.record_fields), auth.profile.blocks.includes("middle_long")),
      memoCandidates: memoHeaderCandidates(columns).map(c => c.index) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "シートを取得できませんでした" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const auth = await access();
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  if (body?.mode === "off") {
    const { error } = await auth.client.rpc("save_october_sheet_setup", { p_sheet_name: "", p_fields: [], p_signature: "", p_mode: "off" });
    return error ? NextResponse.json({ error: "設定を保存できませんでした。もう一度お試しください" }, { status: 502 }) : NextResponse.json({ ok: true });
  }
  if (!body || typeof body.sheetName !== "string" || !["sheet", "app_only"].includes(body.mode) || !Array.isArray(body.fields)) {
    return NextResponse.json({ error: "シートと入力方法を選択してください" }, { status: 400 });
  }
  try {
    const member = await fetchPublicMember(body.sheetName, { spreadsheetId: OCTOBER_SHEET_ID });
    const isMiddleLong = auth.profile.blocks.includes("middle_long");
    const fields = recordFieldsFromJson(body.fields as Json).filter(f => !isMiddleLong || f.key !== "dist_actual");
    const columns = member.columns ?? [];
    if (fields.some(f => f.sourceColumn !== undefined && !columns.some(c => c.index === f.sourceColumn && c.label === f.sourceHeader))) {
      return NextResponse.json({ error: "シートの列が変わりました。もう一度確認してください" }, { status: 409 });
    }
    const signature = relevantSheetHeaderSignature(columns, fields, isMiddleLong);
    if (signature !== body.signature) return NextResponse.json({ error: "見出しが変わりました。もう一度確認してください" }, { status: 409 });
    if (fields.filter(f => f.showInTimeline && !isFixedSheetColumn(f.sourceHeader ?? f.label, isMiddleLong)).length > timelineFieldLimit(isMiddleLong)) {
      return NextResponse.json({ error: "表示項目が上限を超えています" }, { status: 400 });
    }
    const { error } = await auth.client.rpc("save_october_sheet_setup", {
      p_sheet_name: member.name, p_fields: recordFieldsToJson(fields), p_signature: signature, p_mode: body.mode,
    });
    if (error) throw new Error("設定を保存できませんでした。もう一度お試しください");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "設定を保存できませんでした" }, { status: 502 });
  }
}
