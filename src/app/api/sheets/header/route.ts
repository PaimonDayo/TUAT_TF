import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { fetchPublicMember } from "@/lib/sheet-public-csv";
import { memoHeaderCandidates, sheetHeaderSignature } from "@/lib/sheet-field-config";

export const maxDuration = 15;

/** 初回連携・列変更確認用。値は返さず、公開CSVの見出し行だけを返す。 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const roles = await fetchRolesByProfileIds(supabase, [user.id]);
  if (!permissionsOf(roles.get(user.id)).manageSystem) {
    return NextResponse.json({ error: "システム管理権限が必要です" }, { status: 403 });
  }

  const sheetName = new URL(request.url).searchParams.get("sheetName")?.trim();
  if (!sheetName) return NextResponse.json({ error: "シートを選択してください" }, { status: 400 });

  try {
    const member = await fetchPublicMember(sheetName, { timeoutMs: 8_000 });
    const columns = member.columns ?? member.header.map((label, index) => ({ index, label }));
    const dateColumn = columns.find((column) => column.label.replace(/\s+/g, "").trim() === "日付");
    if (!dateColumn) return NextResponse.json({ error: "日付列が見つかりません" }, { status: 422 });
    return NextResponse.json({
      sheetName: member.name,
      columns,
      signature: sheetHeaderSignature(columns),
      memoCandidates: memoHeaderCandidates(columns).map((column) => column.index),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "見出しを取得できませんでした" },
      { status: 502 },
    );
  }
}
