import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { pcVercelProxy } from "@/lib/pc-vercel-proxy";
import { isMaintenanceWindow } from "@/lib/maintenance";

// Next.js 16 では middleware.ts は proxy.ts に改称された（機能は同じ）。
export async function proxy(request: NextRequest) {
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
  matcher: [
    "/api/:path*",
    "/sw.js",
    /*
     * 以下を除く全パスで実行:
     * - _next/static, _next/image（静的アセット）
     * - api（各Route Handler側で本人確認またはBearer認証を行う）
     * - favicon.ico / 画像ファイル
     * - apple-icon / icon / manifest.webmanifest（アプリアイコン・PWA。
     *   ここを認証ガードに通すと未ログイン時に /login へリダイレクトされ、
     *   アイコンが取得できず真っ白になる）
     */
    "/((?!api|_next/static|_next/image|favicon.ico|sw.js|apple-icon|icon|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
