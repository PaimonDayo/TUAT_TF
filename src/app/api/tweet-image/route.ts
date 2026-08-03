import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSafeTweetImagePath, TWEET_IMAGE_BUCKET } from "@/lib/tweet-image";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const path = new URL(request.url).searchParams.get("path");
  if (!path || !isSafeTweetImagePath(path)) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  const { data: tweet } = await supabase.from("tweets").select("id").eq("image_path", path)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).maybeSingle();
  if (!tweet) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  const { data, error } = await supabase.storage.from(TWEET_IMAGE_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  const response = NextResponse.redirect(data.signedUrl, 307);
  response.headers.set("Cache-Control", "private, max-age=240");
  response.headers.set("Vary", "Cookie");
  return response;

}
