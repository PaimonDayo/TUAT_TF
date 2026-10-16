import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Cached clients may still call this endpoint after saving an app comment.
// Never dispatch or replay their old spreadsheet write.
export async function POST() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  return NextResponse.json({ error: "返信のスプレッドシート連携は終了しました。コメントはアプリ内で管理してください。" }, { status: 410 });
}
