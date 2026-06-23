import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchSheetMembers } from "@/lib/sheet-sync";

/** プロフィール編集の「自分のシート」プルダウン候補（部員シート名一覧）を返す */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  try {
    const members = await fetchSheetMembers();
    return NextResponse.json({ members });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "シート一覧を取得できませんでした" },
      { status: 502 },
    );
  }
}
