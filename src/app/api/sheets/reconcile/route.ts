import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Old clients must use period-aware setup instead of reconciling the old workbook. */
export async function POST() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  return NextResponse.json({ error: "入力方法はマイページ → 設定 → 練習記録から変更してください" }, { status: 409 });
}
