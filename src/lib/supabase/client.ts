import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { createCoalescedFetch } from "@/lib/coalesced-fetch";
import { createPcBrowserTransport } from "@/lib/pc-browser-transport";

const coalescedFetch = createCoalescedFetch((input, init) => {
  if (typeof window === "undefined") return fetch(input, init);
  const transport = createPcBrowserTransport(fetch, window.location.origin, process.env.NEXT_PUBLIC_PC_REST_RELAY_ORIGIN);
  return transport(input, init);
});

/** ブラウザ（Client Component）用 Supabase クライアント */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_PC_BACKEND === "true" && typeof window !== "undefined"
      ? `${window.location.origin}/api/pc-supabase`
      : process.env.NEXT_PUBLIC_PC_TRIAL === "true" && typeof window !== "undefined"
      ? `${window.location.origin}/_pc/supabase`
      : process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    process.env.NEXT_PUBLIC_PC_BACKEND === "true" ? {
      cookieOptions: { name: "sb-pc-backend-auth" },
      global: { fetch: coalescedFetch },
    }
      : process.env.NEXT_PUBLIC_PC_TRIAL === "true" ? { cookieOptions: { name: "sb-pc-trial-auth" } } : undefined,
  );
}
