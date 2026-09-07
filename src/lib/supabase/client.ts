import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/** ブラウザ（Client Component）用 Supabase クライアント */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_PC_TRIAL === "true" && typeof window !== "undefined"
      ? `${window.location.origin}/_pc/supabase`
      : process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    process.env.NEXT_PUBLIC_PC_TRIAL === "true" ? { cookieOptions: { name: "sb-pc-trial-auth" } } : undefined,
  );
}
