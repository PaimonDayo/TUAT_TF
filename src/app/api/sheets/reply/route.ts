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
  const commentId =
    typeof body?.commentId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.commentId)
      ? body.commentId
      : undefined;
  if (!recordId || !commentId) {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  // Resolve content through the caller's RLS before using privileged sheet access.
  const { data: comment, error: commentError } = await supabase.from("comments")
    .select("content,sheet_reply_index")
    .eq("id", commentId).eq("user_id", user.id)
    .eq("target_type", "record").eq("target_id", recordId).maybeSingle();
  if (commentError) return NextResponse.json({ ok: false, error: "コメントを確認できませんでした" }, { status: 503 });
  if (!comment) return NextResponse.json({ ok: false, error: "コメントが見つかりません" }, { status: 404 });
  if (comment.sheet_reply_index !== null) return NextResponse.json({ ok: true, replyIndex: comment.sheet_reply_index });
  const text = comment.content.trim();
  if (!text) return NextResponse.json({ ok: false, error: "コメントが空です" }, { status: 400 });

  // 記録 → 作者・日付
  const { data: rec, error: recordError } = await supabase
    .from("practice_records")
    .select("user_id, recorded_date")
    .eq("id", recordId)
    .maybeSingle();
  if (recordError) return NextResponse.json({ ok: false, error: "記録を確認できませんでした" }, { status: 503 });
  if (!rec) return NextResponse.json({ ok: false, error: "記録が見つかりません" }, { status: 404 });
  const admin = createAdminClient();

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
    if (replyIndex == null) throw new Error("返信を書き込む行が見つかりませんでした");
    if (replyIndex != null) {
      const { data: updated, error } = await admin
        .from("comments")
        .update({ sheet_reply_index: replyIndex })
        .eq("id", commentId)
        .eq("user_id", user.id)
        .eq("content", comment.content)
        .eq("target_type", "record")
        .eq("target_id", recordId).select("id").maybeSingle();
      if (error) throw new Error("返信の同期状態を保存できませんでした。もう一度お試しください");
      if (!updated) return NextResponse.json({ ok: false, error: "送信中にコメントが変更されました。内容を確認してください" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, replyIndex });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "返信を書き込めませんでした" },
      { status: 502 },
    );
  }
}
