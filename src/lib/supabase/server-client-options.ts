import { pcAvailable, pcBackendFetch } from "../pc-backend";
import { pcServerOptions } from "./pc-server-options";
import { CLOUD_AUTH_COOKIE, cloudAuthConfig, isCloudDataUrl, pcServerHeaders, routeDataToPc, type CloudAuth } from "./cloud-auth";

/**
 * クラウドの URL あての呼び出しのうち、データの API はPCへ（pcBackendFetch で PC の入口へ届ける）、
 * ログインはそのままクラウドへ送る fetch。PCが止まっているときは、データもクラウドへそのまま送る
 * （クラウドには名簿などの全件と直近3日分の投稿を写してあり、そこへの書き込みはPCの復帰後に書き戻す）。
 */
function pcRoutedFetch(cloud: CloudAuth): typeof fetch {
  const pcOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  const toPc = routeDataToPc(
    (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return url.origin === pcOrigin ? pcBackendFetch(input, init) : fetch(input, init);
    },
    cloud,
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    pcServerHeaders(cloud, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!),
  );
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (isCloudDataUrl(url, cloud) && !(await pcAvailable())) return fetch(input, init);
    return toPc(input, init);
  };
}

/**
 * サーバー側（Server Component・Route Handler・proxy）でログイン中の部員として使う Supabase クライアントの設定。
 * server.ts と middleware.ts で同じものを使う。
 */
export function sessionClientConfig(testOptIn = false): { url: string; key: string; options: Record<string, unknown> } {
  const cloud = cloudAuthConfig(testOptIn);
  if (cloud) {
    return {
      url: cloud.url,
      key: cloud.anonKey,
      options: { cookieOptions: { name: CLOUD_AUTH_COOKIE }, global: { fetch: pcRoutedFetch(cloud) } },
    };
  }
  // 従来どおり（ログインもデータもPC）
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    options: {
      ...pcServerOptions(),
      ...(process.env.NEXT_PUBLIC_PC_BACKEND === "true" ? { cookieOptions: { name: "sb-pc-backend-auth" } } : {}),
      ...(process.env.NEXT_PUBLIC_PC_TRIAL === "true" ? { cookieOptions: { name: "sb-pc-trial-auth" } } : {}),
    },
  };
}
