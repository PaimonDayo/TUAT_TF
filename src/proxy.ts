import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { pcVercelProxy } from "@/lib/pc-vercel-proxy";
import { isMaintenanceWindow } from "@/lib/maintenance";

const nativeOrigin = "https://tuat-pc-app.track-app.workers.dev";
// Match the previous static exclusions after the old production cutover guard.
const staticPath = /^\/(?:api|_next\/static|_next\/image|favicon.ico|sw.js|apple-icon|icon|manifest.webmanifest)|\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/;

// Next.js 16 では middleware.ts は proxy.ts に改称された（機能は同じ）。
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (process.env.VERCEL_ENV === "production" && !process.env.PC_APP_RELEASE_ID) {
    const headers = { "cache-control": "no-store, private", "referrer-policy": "no-referrer" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      return NextResponse.json({ error: "アプリのURLが変わりました。新しいURLを開いてください。", url: nativeOrigin }, {
        status: 503, headers: { ...headers, "retry-after": "60" },
      });
    }
    if (path === "/api/version") return NextResponse.next({ headers });
    // Login credentials belong to the old issuer/session. A fresh login must
    // start at the new origin; no old query string, cookie or body is relayed.
    const target = new URL(nativeOrigin);
    target.pathname = /^\/(?:login(?:\/|$)|auth(?:\/|$)|api\/pc-supabase\/auth(?:\/|$))/.test(path) ? "/login" : path;
    return NextResponse.redirect(target, { status: 307, headers });
  }
  if (path !== "/api" && !path.startsWith("/api/") && path !== "/sw.js" && staticPath.test(path)) return NextResponse.next();
  if (process.env.PC_TRIAL_VERCEL === "true") {
    try {
      const gate = await pcVercelProxy(request);
      if (gate) return gate;
    } catch {
      return NextResponse.json({ error: "PC試験版に接続できません" }, { status: 503 });
    }
  }
  // Normal API handlers retain their own authentication without duplicate Auth calls.
  if (request.nextUrl.pathname.startsWith("/api/") || request.nextUrl.pathname === "/sw.js") return NextResponse.next();
  // サーバー切替の計画メンテナンス中は、バックエンドが不安定なため updateSession
  // （DBを読みに行く）自体を呼ばず、時刻だけで判定してメンテナンス画面を返す。
  if (isMaintenanceWindow()) {
    if (request.nextUrl.pathname === "/maintenance") return NextResponse.next();
    return NextResponse.rewrite(new URL("/maintenance", request.url));
  }
  return await updateSession(request);
}

export const config = {
  // Every old production write is refused, including paths with asset suffixes.
  // Native/development/preview keep the previous asset bypass above.
  matcher: ["/:path*"],
};
