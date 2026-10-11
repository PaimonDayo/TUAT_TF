import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { timingSafeEqualString } from "@/lib/timing-safe";
import { TWEET_IMAGE_BUCKET } from "@/lib/tweet-image";
import { removeImages } from "@/lib/image-storage";
import { cleanupNoteImages } from "@/lib/note-image-cleanup";
import { pcAppWriteProtectionResponse, pcBackupProtectionResponse } from "@/lib/pc-backup-status";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !timingSafeEqualString(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const protectedResponse = await pcAppWriteProtectionResponse();
  if (protectedResponse) return protectedResponse;
  try { await cleanupNoteImages(); } catch (error) { return pcBackupProtectionResponse(error) ?? NextResponse.json({error:"Note image cleanup failed"},{status:503}); }
  const { data: stories, error } = await supabase
    .from("tweets")
    .select("id, image_path")
    .not("expires_at", "is", null)
    .lte("expires_at", new Date().toISOString())
    .limit(500);
  if (error) return pcBackupProtectionResponse(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  if (!stories?.length) return NextResponse.json({ deleted: 0 });

  const imagePaths = stories.flatMap((story) => story.image_path ? [story.image_path] : []);
  if (imagePaths.length) {
    try {
      await removeImages(supabase, TWEET_IMAGE_BUCKET, imagePaths);
    } catch (error) {
      const protection = pcBackupProtectionResponse(error);
      if (protection) return protection;
      console.error("Failed to remove expired story images", error);
      return NextResponse.json({ error: "Image cleanup failed" }, { status: 500 });
    }
  }

  const ids = stories.map((story) => story.id);
  const cleanupResults = await Promise.all([
    supabase.from("likes").delete().eq("target_type", "tweet").in("target_id", ids),
    supabase.from("comments").delete().eq("target_type", "tweet").in("target_id", ids),
  ]);
  const cleanupError = cleanupResults.find((result) => result.error)?.error;
  if (cleanupError) return partialCleanupFailure(cleanupError, imagePaths.length);

  const { error: deleteError } = await supabase.from("tweets").delete().in("id", ids);
  if (deleteError) return partialCleanupFailure(deleteError, imagePaths.length);
  return NextResponse.json({ deleted: ids.length, imagesDeleted: imagePaths.length });
}

async function partialCleanupFailure(error: { message: string }, imagesDeleted: number) {
  const protection = pcBackupProtectionResponse(error);
  return NextResponse.json({ ...(protection ? await protection.json() : { error: "削除処理の完了を確認できませんでした" }),
    outcome: "partial", retryable: false, imagesDeleted, deletionConfirmed: false },
  { status: protection ? 503 : 500, headers: { "cache-control": "private, no-store" } });
}
