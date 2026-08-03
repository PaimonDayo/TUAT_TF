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
    .download(path);
  if (error || !data) {
    console.warn("Failed to download avatar", error);
    return NextResponse.json({ error: "画像が見つかりません" }, { status: 404 });
  }

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(data.size),
      "Content-Type":
        data.type || (path.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg"),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
