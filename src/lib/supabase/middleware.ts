import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * リクエストごとにセッションを更新し、未認証ユーザーを /login へ誘導する。
 * proxy.ts（旧 middleware.ts）から呼ばれる。
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
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
    error,
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth");

  // Supabase の認証クッキー（sb-<ref>-auth-token[.n]）が存在するか。
  // クッキーがあるのに user が取れない場合は「本当のログアウト」ではなく、
  // レート制限・ネットワーク等の一時的失敗の可能性が高い。
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.includes("-auth-token"));

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

  // 完全に未認証（認証クッキーが無い）で保護ページ → /login
  if (!user && !hasAuthCookie && !isPublic) {
    return redirectTo("/login");
  }

  // 認証クッキーはあるが user が取れなかった（= 一時的失敗の可能性）。
  // ここでログアウトさせず通す。ページ側は getSession でクッキーを読み、
  // データのアクセス制御は RLS が担保する。次のリクエストで回復を試みる。
  if (!user && error) {
    console.warn("[proxy] getUser failed but auth cookie exists:", error.message);
  }

  return response;
}
