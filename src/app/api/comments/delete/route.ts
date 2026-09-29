import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMemberPreviewActive } from "@/lib/supabase/auth";
import { flushReplyDeletions } from "@/lib/sheet-sync/reply-deletions";

export const maxDuration = 60;
export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user || await isMemberPreviewActive()) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id ?? "") || !["app", "sheet"].includes(body.kind)) return NextResponse.json({ error: "削除対象を確認してください" }, { status: 400 });
  // The caller's DB session checks the exact role/ownership and creates a trusted receipt.
  const result = await client.rpc("delete_comment_with_sheet", { p_id: body.id, p_kind: body.kind });
  if (result.error) return NextResponse.json({ error: "コメントを削除できませんでした" }, { status: result.error.code === "42501" ? 403 : 409 });
  let pending = false;
  if (result.data) {
    try { pending = (await flushReplyDeletions(createAdminClient(), result.data)).length > 0; }
    catch { pending = true; }
  }
  return NextResponse.json({ ok: true, pending });
}
