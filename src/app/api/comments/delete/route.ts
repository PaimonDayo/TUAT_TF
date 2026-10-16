import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pcAppWriteProtectionResponse, pcBackupProtectionResponse } from "@/lib/pc-backup-status";
import { isMemberPreviewActive } from "@/lib/supabase/auth";

export const maxDuration = 60;
export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user || await isMemberPreviewActive()) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id ?? "") || !["app", "sheet"].includes(body.kind)) return NextResponse.json({ error: "削除対象を確認してください" }, { status: 400 });
  if (body.kind === "sheet") return NextResponse.json({ error: "スプレッドシート由来の返信はアプリで扱わなくなりました。" }, { status: 410 });
  // The caller's DB session preserves the existing owner/moderator authorization.
  const protectedResponse = await pcAppWriteProtectionResponse();
  if (protectedResponse) return protectedResponse;
  const result = await client.rpc("delete_comment_with_sheet", { p_id: body.id, p_kind: body.kind });
  const protection = pcBackupProtectionResponse(result.error);
  if (protection) return protection;
  if (result.error) return NextResponse.json({ error: "コメントを削除できませんでした" }, { status: result.error.code === "42501" ? 403 : 409 });
  if (result.data !== body.id) return NextResponse.json({ error: "削除対象のコメントを確認できませんでした。画面を再読み込みして確認してください。" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
