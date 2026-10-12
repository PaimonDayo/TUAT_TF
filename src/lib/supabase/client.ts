import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { createCoalescedFetch } from "@/lib/coalesced-fetch";
import { createPcBrowserTransport } from "@/lib/pc-browser-transport";
import { createPcAppDataFetch, isPcAppCloudDataRequest, pcAppCloudAuthConfig, pcAppLocalAuthEnabled } from "@/lib/pc-app-transport";
import { CLOUD_AUTH_COOKIE, browserCloudAuthOptIn, cloudAuthConfig, routeDataToPc, withCloudFailover } from "./cloud-auth";
import { createCloudAuthFetch } from "./auth-fetch";

const coalescedFetch = createCoalescedFetch((input, init) => {
  if (pcAppLocalAuthEnabled()) {
    if (typeof window === "undefined") throw new Error("PC app server requests must use the server Supabase client");
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/pc-supabase/")) throw new Error("Local Auth and data require the same application origin");
    return fetch(input, init);
  }
  if (typeof window === "undefined") {
    if (process.env.NEXT_PUBLIC_PC_APP_RUNTIME === "true" && isPcAppCloudDataRequest(input, pcAppCloudAuthConfig())) {
      throw new Error("PC app server data must use the server Supabase client");
    }
    return fetch(input, init);
  }
  if (process.env.NEXT_PUBLIC_PC_APP_RUNTIME === "true") {
    return createPcAppDataFetch(fetch, pcAppCloudAuthConfig(), `${window.location.origin}/api/pc-supabase`)(input, init);
  }
  const transport = createPcBrowserTransport(fetch, window.location.origin, process.env.NEXT_PUBLIC_PC_REST_RELAY_ORIGIN);
  const cloud = cloudAuthConfig(browserCloudAuthOptIn());
  if (!cloud) return transport(input, init);
  // ログインがクラウドのときは、データの API だけPCの入口（/api/pc-supabase、さらに中継）へ付け替える。
  // PCが止まっていると分かったら、しばらくクラウドへ直接つなぐ。
  return withCloudFailover(routeDataToPc(transport, cloud, `${window.location.origin}/api/pc-supabase`), fetch, cloud)(input, init);
});

/** ブラウザ（Client Component）用 Supabase クライアント */
export function createClient() {
  if (pcAppLocalAuthEnabled()) {
    const url = typeof window === "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_URL! : `${window.location.origin}/api/pc-supabase`;
    return createBrowserClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookieOptions: { name: "sb-pc-backend-auth" }, global: { fetch: createCloudAuthFetch(coalescedFetch, url) },
    });
  }
  const cloud = process.env.NEXT_PUBLIC_PC_APP_RUNTIME === "true" ? pcAppCloudAuthConfig() : cloudAuthConfig(browserCloudAuthOptIn());
  if (cloud) {
    return createBrowserClient<Database>(cloud.url, cloud.anonKey, {
      cookieOptions: { name: CLOUD_AUTH_COOKIE },
      global: { fetch: createCloudAuthFetch(coalescedFetch, cloud.url) },
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
