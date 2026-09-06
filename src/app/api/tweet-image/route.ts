import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSafeTweetImagePath, TWEET_IMAGE_BUCKET } from "@/lib/tweet-image";
import { signedImageUrl } from "@/lib/image-storage";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const path = new URL(request.url).searchParams.get("path");
  if (!path || !isSafeTweetImagePath(path)) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  const { data: tweet } = await supabase.from("tweets").select("id, expires_at").eq("image_path", path)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).maybeSingle();
  if (!tweet) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  const ttl = tweet.expires_at ? Math.min(300, Math.floor((Date.parse(tweet.expires_at) - Date.now()) / 1000)) : 300;
  if (ttl <= 0) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  let url: string;
  try {
    url = await signedImageUrl(supabase, TWEET_IMAGE_BUCKET, path, ttl);
  } catch {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
  const response = NextResponse.redirect(url, 307);
  response.headers.set("Cache-Control", `private, max-age=${Math.min(240, Math.max(0, ttl - 30))}`);
  response.headers.set("Vary", "Cookie");
  return response;

}
