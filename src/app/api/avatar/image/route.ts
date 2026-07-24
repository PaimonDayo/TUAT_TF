import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  AVATAR_BUCKET,
  isSafeAvatarStoragePath,
} from "@/lib/avatar-image";

export const runtime = "nodejs";

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
    .createSignedUrl(path, 300);
  if (error || !data?.signedUrl) {
    console.warn("Failed to sign avatar URL", error);
    return NextResponse.json({ error: "画像が見つかりません" }, { status: 404 });
  }

  const response = NextResponse.redirect(data.signedUrl, 307);
  response.headers.set("Cache-Control", "private, max-age=240");
  response.headers.set("Vary", "Cookie");
  return response;
}
