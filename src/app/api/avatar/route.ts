import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import {
  AVATAR_BUCKET,
  AVATAR_OUTPUT_SIZE,
  avatarStoragePathFromPublicUrl,
} from "@/lib/avatar-image";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/webp"]);

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function POST(request: Request) {
  const { supabase, user } = await authenticatedClient();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const contentType = request.headers.get("content-type")?.split(";", 1)[0] ?? "";
  if (!ACCEPTED_TYPES.has(contentType)) {
    return NextResponse.json({ error: "対応していない画像形式です" }, { status: 415 });
  }

  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "画像の容量が大きすぎます" }, { status: 413 });
  }

  const input = Buffer.from(await request.arrayBuffer());
  if (!input.length || input.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "画像の容量が大きすぎます" }, { status: 413 });
  }

  try {
    const [{ data: profile, error: profileError }, output] = await Promise.all([
      supabase.from("profiles").select("avatar_url").eq("id", user.id).maybeSingle(),
      sharp(input)
        .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, { fit: "cover" })
        .webp({ quality: 82 })
        .toBuffer(),
    ]);
    if (profileError || !profile) {
      return NextResponse.json({ error: "プロフィールを確認できませんでした" }, { status: 404 });
    }

    const uploadedPath = `${user.id}/${crypto.randomUUID()}.webp`;
    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(uploadedPath, output, {
        cacheControl: "31536000",
        contentType: "image/webp",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const avatarUrl = supabase.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(uploadedPath).data.publicUrl;
    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: avatarUrl })
      .eq("id", user.id)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) {
      await supabase.storage.from(AVATAR_BUCKET).remove([uploadedPath]);
      throw updateError ?? new Error("Profile update was blocked");
    }

    const previousPath = avatarStoragePathFromPublicUrl(
      profile.avatar_url,
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      user.id,
    );
    if (previousPath && previousPath !== uploadedPath) {
      const { error: removeError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .remove([previousPath]);
      if (removeError) console.warn("Failed to remove the previous avatar", removeError);
    }

    return NextResponse.json({ ok: true, avatarUrl });
  } catch (error) {
    console.error("Failed to save avatar", error);
    return NextResponse.json(
      { error: "画像を保存できませんでした。もう一度お試しください" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const { supabase, user } = await authenticatedClient();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile) {
    return NextResponse.json({ error: "プロフィールを確認できませんでした" }, { status: 404 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) {
    return NextResponse.json({ error: "画像を削除できませんでした" }, { status: 500 });
  }

  const previousPath = avatarStoragePathFromPublicUrl(
    profile.avatar_url,
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    user.id,
  );
  if (previousPath) {
    const { error: removeError } = await supabase.storage.from(AVATAR_BUCKET).remove([previousPath]);
    if (removeError) console.warn("Failed to remove avatar", removeError);
  }
  return NextResponse.json({ ok: true });
}
