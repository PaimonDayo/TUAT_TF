import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

/**
 * リクエストごとにセッションを更新し、未認証ユーザーを /login へ誘導する。
 * proxy.ts（旧 middleware.ts）から呼ばれる。
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() を呼ぶことでセッションが検証・更新される（重要）
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    // 同期APIは route 側で独自に認証（cron=Bearer / 手動=管理者）。
    // 未ログイン(cron)を /login にリダイレクトすると叩けないので素通りさせる。
    pathname.startsWith("/offline") ||
    // GETはroute内でシステム管理権限を確認し、POSTは旧アプリの署名トークンを検証する。
    pathname.startsWith("/api/legacy-access") ||
    pathname.startsWith("/api/sheets/sync") ||
    pathname.startsWith("/api/schedule-sheets/cron-sync");

  // 更新後のクッキーを必ず引き継いでリダイレクトする（重要）。
  // 単に NextResponse.redirect すると getUser で更新されたトークンが失われ、
  // 次回も再更新が走ってログアウトの原因になる。
  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  // 認証済みで /login → /home
  if (user && pathname.startsWith("/login")) {
    return redirectTo("/home");
  }

  // API clients need JSON instead of a redirect to the login page.
  if (!user && !isPublic && pathname.startsWith("/api/")) {
    const unauthorized = NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
    response.cookies.getAll().forEach((cookie) =>
      unauthorized.cookies.set(cookie),
    );
    return unauthorized;
  }

  // Browser navigation to protected pages still goes through the login flow.
  if (!user && !isPublic) {
    return redirectTo("/login");
  }

  return response;
}
