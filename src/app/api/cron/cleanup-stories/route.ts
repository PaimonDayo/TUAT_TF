import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { timingSafeEqualString } from "@/lib/timing-safe";
import { TWEET_IMAGE_BUCKET } from "@/lib/tweet-image";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !timingSafeEqualString(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: stories, error } = await supabase
    .from("tweets")
    .select("id, image_path")
    .not("expires_at", "is", null)
    .lte("expires_at", new Date().toISOString())
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!stories?.length) return NextResponse.json({ deleted: 0 });

  const imagePaths = stories.flatMap((story) => story.image_path ? [story.image_path] : []);
  if (imagePaths.length) {
    const { error: storageError } = await supabase.storage.from(TWEET_IMAGE_BUCKET).remove(imagePaths);
    if (storageError) return NextResponse.json({ error: storageError.message }, { status: 500 });
  }

  const ids = stories.map((story) => story.id);
  const cleanupResults = await Promise.all([
    supabase.from("likes").delete().eq("target_type", "tweet").in("target_id", ids),
    supabase.from("comments").delete().eq("target_type", "tweet").in("target_id", ids),
  ]);
  const cleanupError = cleanupResults.find((result) => result.error)?.error;
  if (cleanupError) return NextResponse.json({ error: cleanupError.message }, { status: 500 });

  const { error: deleteError } = await supabase.from("tweets").delete().in("id", ids);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  return NextResponse.json({ deleted: ids.length, imagesDeleted: imagePaths.length });
}