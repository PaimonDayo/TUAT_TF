import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 では middleware.ts は proxy.ts に改称された（機能は同じ）。
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 以下を除く全パスで実行:
     * - _next/static, _next/image（静的アセット）
     * - favicon.ico / 画像ファイル
     * - apple-icon / icon / manifest.webmanifest（アプリアイコン・PWA。
     *   ここを認証ガードに通すと未ログイン時に /login へリダイレクトされ、
     *   アイコンが取得できず真っ白になる）
     */
    "/((?!_next/static|_next/image|favicon.ico|apple-icon|icon|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
