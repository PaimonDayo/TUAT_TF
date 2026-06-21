"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/auth";

export async function markNotificationAsRead(id: string) {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", id)
    .eq("user_id", profile.id);
}

export async function markAllNotificationsAsRead() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", profile.id)
    .eq("is_read", false);
}

export async function deleteNotification(id: string) {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .delete()
    .eq("id", id)
    .eq("user_id", profile.id);
}
