import { createClient } from "@/lib/supabase/client";

/** Identity hint for RLS-backed browser operations. Never an authorization check. */
export async function getCurrentUserId(supabase = createClient()): Promise<string | null> {
  const { data: { session }, error } = await supabase.auth.getSession();
  return error ? null : session?.user.id ?? null;
}
