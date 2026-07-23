import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeSheetReply } from "@/lib/sheet-sync";

/**
 * アプリの「記録へのコメント」を、記録の作者のスプレッドシート（当日の行の右側＝列名なし列）へ
 * 旧TFアプリと同じ形式で書き込む。「{コメント}　{投稿者名}」。
 * 作者がシート連携していない場合は何もしない（アプリ内コメントは従来どおり）。
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const recordId = typeof body?.recordId === "string" ? body.recordId : "";
  const text = (body?.text ?? "").toString().trim();
  const commentId =
    typeof body?.commentId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.commentId)
      ? body.commentId
      : undefined;
  if (!recordId || !text) {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 記録 → 作者・日付
  const { data: rec } = await admin
    .from("practice_records")
    .select("user_id, recorded_date")
    .eq("id", recordId)
    .maybeSingle();
  if (!rec) return NextResponse.json({ ok: true, skipped: "no record" });

  // 作者がシート連携していなければ何もしない
  const { data: author } = await admin
    .from("profiles")
    .select("sheet_name")
    .eq("id", rec.user_id)
    .maybeSingle();
  if (!author?.sheet_name) {
    return NextResponse.json({ ok: true, skipped: "author not linked" });
  }

  // コメント投稿者の名前を末尾に付ける
  const { data: me } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  const name = (me?.display_name ?? "").trim();
  const replyText = name ? `${text}　${name}` : text;

  try {
    const replyIndex = await writeSheetReply(
      author.sheet_name,
      rec.recorded_date,
      replyText,
      commentId,
    );
    if (commentId && replyIndex != null) {
      await admin
        .from("comments")
        .update({ sheet_reply_index: replyIndex })
        .eq("id", commentId)
        .eq("target_type", "record")
        .eq("target_id", recordId);
    }
    return NextResponse.json({ ok: true, replyIndex });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "失敗しました" },
      { status: 502 },
    );
  }
}
