import { createAdminClient } from "@/lib/supabase/admin";
/** Legacy rows mix confirmed deletions with uncertain insert compensations.
 * There is no provenance or transaction barrier proving they cannot be referenced
 * by a delayed commit. Retain objects and queue rows until verified cleanup. */
export async function cleanupNoteImages() {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("note_image_cleanup")
    .select("*", { count: "exact", head: true });
  if (error) throw error;
  if (count) console.info("Note image cleanup deferred", { queued: count });
  return 0;
}
