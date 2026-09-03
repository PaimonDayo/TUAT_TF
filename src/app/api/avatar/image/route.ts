import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  AVATAR_BUCKET,
  isSafeAvatarStoragePath,
} from "@/lib/avatar-image";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const REDIRECT_CACHE_SECONDS = 6 * 24 * 60 * 60;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const path = new URL(request.url).searchParams.get("path");
  if (!path || !isSafeAvatarStoragePath(path)) {
    return NextResponse.json({ error: "画像が見つかりません" }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    console.warn("Failed to sign avatar URL", error);
    return NextResponse.json({ error: "画像が見つかりません" }, { status: 404 });
  }

  // The object path changes whenever an avatar is replaced. Cache this private
  // redirect for less than the signed URL lifetime and let Supabase Storage/CDN
  // serve the image bytes directly instead of buffering them in Vercel.
  const response = NextResponse.redirect(data.signedUrl, 307);
  response.headers.set("Cache-Control", `private, max-age=${REDIRECT_CACHE_SECONDS}, immutable`);
  return response;
}
