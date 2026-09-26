import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { createCoalescedFetch } from "@/lib/coalesced-fetch";
import { createPcBrowserTransport } from "@/lib/pc-browser-transport";
import { CLOUD_AUTH_COOKIE, browserCloudAuthOptIn, cloudAuthConfig, routeDataToPc } from "./cloud-auth";

const coalescedFetch = createCoalescedFetch((input, init) => {
  if (typeof window === "undefined") return fetch(input, init);
  const transport = createPcBrowserTransport(fetch, window.location.origin, process.env.NEXT_PUBLIC_PC_REST_RELAY_ORIGIN);
  const cloud = cloudAuthConfig(browserCloudAuthOptIn());
  // ログインがクラウドのときは、データの API だけPCの入口（/api/pc-supabase、さらに中継）へ付け替える。
  return cloud ? routeDataToPc(transport, cloud, `${window.location.origin}/api/pc-supabase`)(input, init) : transport(input, init);
});

/** ブラウザ（Client Component）用 Supabase クライアント */
export function createClient() {
  const cloud = cloudAuthConfig(browserCloudAuthOptIn());
  if (cloud) {
    return createBrowserClient<Database>(cloud.url, cloud.anonKey, {
      cookieOptions: { name: CLOUD_AUTH_COOKIE },
      global: { fetch: coalescedFetch },
    });
  }
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
