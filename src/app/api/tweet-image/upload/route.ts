import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { uploadImage, removeImages } from "@/lib/image-storage";
import { isSafeTweetImagePath, TWEET_IMAGE_BUCKET, TWEET_IMAGE_MAX_UPLOAD_BYTES } from "@/lib/tweet-image";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const type = request.headers.get("content-type")?.split(";", 1)[0];
  if (!type || !["image/webp", "image/jpeg", "image/png"].includes(type)) {
    return NextResponse.json({ error: "対応していない画像形式です" }, { status: 415 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > TWEET_IMAGE_MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "画像の容量が大きすぎます" }, { status: 413 });
  }
  const input = Buffer.from(await request.arrayBuffer());
  if (!input.length || input.length > TWEET_IMAGE_MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "画像の容量が大きすぎます" }, { status: 413 });
  }
  let output: Buffer;
  try {
    output = await sharp(input, { limitInputPixels: 50_000_000 })
      .rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer();
  } catch {
    return NextResponse.json({ error: "画像を読み込めませんでした" }, { status: 400 });
  }
  if (output.length > TWEET_IMAGE_MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "画像の容量が大きすぎます" }, { status: 413 });
  }
  const path = `${user.id}/${crypto.randomUUID()}.webp`;
  try {
    await uploadImage(supabase, TWEET_IMAGE_BUCKET, path, output);
    return NextResponse.json({ path }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Story image upload failed", error);
    return NextResponse.json({ error: "画像をアップロードできませんでした" }, { status: 503 });
  }
}

// Only unused drafts owned by the caller can be removed through this endpoint.
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const path = new URL(request.url).searchParams.get("path");
  if (!path || !isSafeTweetImagePath(path) || !path.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
  const { data, error } = await supabase.from("tweets").select("id").eq("image_path", path).limit(1);
  if (error || data?.length) return NextResponse.json({ error: "Image is in use" }, { status: 409 });
  try {
    await removeImages(supabase, TWEET_IMAGE_BUCKET, [path]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Image cleanup failed" }, { status: 503 });
  }
}
