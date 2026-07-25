import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordFieldsFromJson, recordFieldsToJson } from "@/lib/profile-normalize";
import type { Json } from "@/types/database";
import { isFixedSheetColumn, timelineFieldLimit } from "@/lib/sheet-field-config";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json().catch(() => null) as { fields?: unknown; signature?: unknown } | null;
  const fields = recordFieldsFromJson((body?.fields ?? null) as Json);
  const signature = typeof body?.signature === "string" ? body.signature : null;
  if (!signature) return NextResponse.json({ error: "見出し情報がありません" }, { status: 400 });

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("blocks, sheet_name")
    .eq("id", user.id)
    .single();
  if (profileError || !profile?.sheet_name) {
    return NextResponse.json({ error: "スプシ連携が設定されていません" }, { status: 400 });
  }
  const isMiddleLong = (profile.blocks ?? []).includes("middle_long");
  const displayedOptional = fields.filter((field) =>
    field.showInTimeline === true && !isFixedSheetColumn(field.sourceHeader ?? field.label, isMiddleLong));
  if (displayedOptional.length > timelineFieldLimit(isMiddleLong)) {
    return NextResponse.json({ error: "タイムライン表示項目が上限を超えています" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ record_fields: recordFieldsToJson(fields), sheet_header_signature: signature })
    .eq("id", user.id)
    .select("record_fields_version")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, version: data.record_fields_version });
}