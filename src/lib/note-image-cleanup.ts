import { createAdminClient } from "@/lib/supabase/admin";
import { removeImages } from "@/lib/image-storage";
/** Bounded durable queue. Retain rows on failure so the next cron retries. */
export async function cleanupNoteImages() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("note_image_cleanup")
    .select("path")
    .order("created_at")
    .limit(100);
  if (error) throw error;
  const paths = (data ?? []).map((row) => row.path);
  if (!paths.length) return 0;
  await removeImages(admin, "note-images", paths);
  const result = await admin
    .from("note_image_cleanup")
    .delete()
    .in("path", paths);
  if (result.error) throw result.error;
  return paths.length;
}
