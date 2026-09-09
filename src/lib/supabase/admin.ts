import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { pcServerOptions } from "./pc-server-options";

export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      ...pcServerOptions(),
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
