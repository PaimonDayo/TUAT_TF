// ログインはクラウドSupabase、データはPC（予備構成、2026-09-26 オーナー確定）。
//
// NEXT_PUBLIC_CLOUD_AUTH_URL と NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY を設定したときだけ有効になる。未設定なら従来どおり
// （ログインもデータもPC）。Supabaseのクライアントはクラウドの URL で作り、ログイン（/auth/v1）はそのまま
// クラウドへ、データ（/rest・/storage・/functions）はPCへ振り分ける。クラウドのログインはPCのDBも受け付ける
// （PCの JWT_JWKS にクラウドの公開鍵を追加済み）。

export type CloudAuth = { url: string; anonKey: string };

/** 全員を切り替える前に、この目印のcookieを持つブラウザだけでクラウドのログインを試すためのもの。 */
export const CLOUD_AUTH_TEST_COOKIE = "tuat-cloud-auth-test";

/**
 * ログインをクラウドで行う設定になっているか。PCバックエンド運用中だけ有効にする。
 * NEXT_PUBLIC_CLOUD_AUTH_MODE が "test" のときは、目印のcookieを持つブラウザ（testOptIn）だけ有効。
 */
export function cloudAuthConfig(testOptIn = false): CloudAuth | null {
  const url = process.env.NEXT_PUBLIC_CLOUD_AUTH_URL;
  const anonKey = process.env.NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY;
  if (process.env.NEXT_PUBLIC_PC_BACKEND !== "true" || !url || !anonKey) return null;
  if (process.env.NEXT_PUBLIC_CLOUD_AUTH_MODE === "test" && !testOptIn) return null;
  return { url: url.replace(/\/$/, ""), anonKey };
}

/** ブラウザで、試しに使う目印のcookieがあるか */
export function browserCloudAuthOptIn(): boolean {
  return typeof document !== "undefined" && document.cookie.split(";").some((c) => c.trim() === `${CLOUD_AUTH_TEST_COOKIE}=1`);
}

/** クラウドのログインを保存するcookie。PCのログイン（sb-pc-backend-auth）とは別の名前にして、切替時に全員1回ログインし直す。 */
export const CLOUD_AUTH_COOKIE = "sb-tuat-auth";

const DATA_API = /^\/(rest|storage|functions)\/v1(?:\/|$)/;

/**
 * クラウドの URL あての呼び出しのうち、データの API だけを dataBase（PCの入口）へ付け替える。
 * ログイン（/auth/v1）はそのまま通す。
 */
export function routeDataToPc(
  fetcher: typeof fetch,
  cloud: CloudAuth,
  dataBase: string,
  rewriteHeaders?: (headers: Headers) => void,
): typeof fetch {
  const base = dataBase.replace(/\/$/, "");
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!`${url.origin}${url.pathname}`.startsWith(cloud.url) || !DATA_API.test(url.pathname)) return fetcher(input, init);
    const target = `${base}${url.pathname}${url.search}`;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    rewriteHeaders?.(headers);
    if (input instanceof Request) return fetcher(new Request(target, new Request(input, { ...init, headers })));
    return fetcher(target, { ...init, headers });
  };
}

/**
 * サーバーからPCへ送るときの認証ヘッダーの付け替え。PCの入口はPCの anon キーしか受け付けない。
 * ログインしていない呼び出しは Authorization にクラウドの anon キーが入るので、PCの anon キーに替える
 * （ログイン中の部員のトークンはクラウド発行でもPCが受け付けるので、そのまま渡す）。
 */
export function pcServerHeaders(cloud: CloudAuth, pcAnonKey: string) {
  return (headers: Headers) => {
    headers.set("apikey", pcAnonKey);
    if (headers.get("authorization") === `Bearer ${cloud.anonKey}`) headers.set("authorization", `Bearer ${pcAnonKey}`);
  };
}
