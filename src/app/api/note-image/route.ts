import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedImageUrl, uploadImage } from "@/lib/image-storage";
import { cleanupNoteImages } from "@/lib/note-image-cleanup";
import { TWEET_IMAGE_MAX_UPLOAD_BYTES } from "@/lib/tweet-image";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id)
    return NextResponse.json(
      { error: "画像が見つかりません" },
      { status: 404 },
    );
  const { data, error } = await sb
    .from("note_article_images")
    .select("path")
    .eq("id", id)
    .maybeSingle();
  if (error || !data)
    return NextResponse.json(
      { error: "画像が見つかりません" },
      { status: 404 },
    );
  try {
    const url = await signedImageUrl(sb, "note-images", data.path, 300);
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Cache-Control", "private, max-age=240");
    response.headers.set("Vary", "Cookie");
    return response;
  } catch {
    return NextResponse.json(
      { error: "画像を取得できませんでした" },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const articleId = new URL(request.url).searchParams.get("articleId");
  if (!articleId)
    return NextResponse.json(
      { error: "記事が見つかりません" },
      { status: 404 },
    );
  const { data: article } = await sb
    .from("note_articles")
    .select("note_id")
    .eq("id", articleId)
    .maybeSingle();
  const permission = article
    ? await sb.rpc("can_edit_note", { target_note_id: article.note_id })
    : null;
  if (!permission?.data || permission.error)
    return NextResponse.json(
      { error: "画像を追加する権限がありません" },
      { status: 403 },
    );
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(
      request.headers.get("content-type")?.split(";")[0] ?? "",
    )
  )
    return NextResponse.json(
      { error: "JPG・PNG・WebPを選んでください" },
      { status: 415 },
    );
  if (
    Number(request.headers.get("content-length")) > TWEET_IMAGE_MAX_UPLOAD_BYTES
  )
    return NextResponse.json(
      { error: "画像の容量が大きすぎます" },
      { status: 413 },
    );
  const input = Buffer.from(await request.arrayBuffer());
  if (!input.length || input.length > TWEET_IMAGE_MAX_UPLOAD_BYTES)
    return NextResponse.json(
      { error: "画像の容量が大きすぎます" },
      { status: 413 },
    );
  let output: Buffer;
  try {
    output = await sharp(input, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return NextResponse.json(
      { error: "画像を読み込めませんでした" },
      { status: 400 },
    );
  }
  if (output.length > TWEET_IMAGE_MAX_UPLOAD_BYTES)
    return NextResponse.json(
      { error: "画像の容量が大きすぎます" },
      { status: 413 },
    );
  const uploadId = new URL(request.url).searchParams.get("uploadId");
  if (
    !uploadId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      uploadId,
    )
  )
    return NextResponse.json(
      { error: "画像の識別情報が不正です" },
      { status: 400 },
    );
  const path = `${articleId}/${uploadId}.webp`;
  const existing = await sb
    .from("note_article_images")
    .select("id,path")
    .eq("path", path)
    .maybeSingle();
  if (existing.error)
    return NextResponse.json(
      { error: "画像を確認できませんでした" },
      { status: 503 },
    );
  if (existing.data)
    return NextResponse.json(existing.data, {
      headers: { "Cache-Control": "no-store" },
    });
  try {
    await uploadImage(sb, "note-images", path, output);
  } catch {
    return NextResponse.json(
      { error: "画像を保存できませんでした" },
      { status: 503 },
    );
  }
  const result = await sb
    .from("note_article_images")
    .insert({ article_id: articleId, path, created_by: user.id })
    .select("id,path")
    .single();
  if (result.error) {
    const queued = await createAdminClient()
      .from("note_image_cleanup")
      .insert({ path });
    if (queued.error)
      console.error("Failed to queue unused note image", queued.error.code);
    await cleanupNoteImages().catch(() => undefined);
    return NextResponse.json(
      { error: "画像を登録できませんでした。1記事につき6枚まで追加できます。" },
      { status: 409 },
    );
  }
  return NextResponse.json(result.data, {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function DELETE(request: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id)
    return NextResponse.json(
      { error: "画像が見つかりません" },
      { status: 404 },
    );
  const existing = await sb
    .from("note_article_images")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (existing.error)
    return NextResponse.json(
      { error: "画像を確認できませんでした" },
      { status: 503 },
    );
  if (!existing.data) return NextResponse.json({ ok: true });
  const { data, error } = await sb
    .from("note_article_images")
    .delete()
    .eq("id", id)
    .select("id");
  if (error || !data?.length)
    return NextResponse.json(
      { error: "画像を削除できませんでした" },
      { status: 403 },
    );
  await cleanupNoteImages().catch(() => undefined);
  return NextResponse.json({ ok: true });
}
