/** 中継が失敗した後、すべての通信を元の経路（Vercel）へ回す時間。 */
export const RELAY_BYPASS_MS = 10 * 60 * 1000;

/** 中継の上限超過や一時障害とみなす応答。Cloudflareの上限超過はCORSヘッダーが付かず通信エラーになる。 */
const RELAY_UNAVAILABLE = new Set([429, 502, 503, 504]);

type RelayState = { bypassUntil: number };
// 画面内で作られるクライアントが何個あっても、迂回の状態は1つにまとめる。
const sharedState: RelayState = { bypassUntil: 0 };

/**
 * Route only PostgREST to the optional edge relay. Auth URL/cookies stay unchanged.
 *
 * 中継（Cloudflare Worker）が無料枠の上限や障害で使えないときも画面を止めないため:
 * - 読み込み（GET/HEAD）が失敗したら、その場で元の経路から取り直す。
 * - 失敗を見たら RELAY_BYPASS_MS の間は保存も含めて全部元の経路を使う。
 * - 失敗した保存そのものは送り直さない（書き込み後に通信が切れた可能性があり、二重保存になりうる）。
 */
export function createPcBrowserTransport(
  fetcher: typeof fetch,
  appOrigin: string,
  relay?: string,
  options: { now?: () => number; state?: RelayState } = {},
): typeof fetch {
  if (!relay) return fetcher;
  const edge = new URL(relay);
  if (edge.protocol !== "https:" || edge.username || edge.password || edge.pathname !== "/" || edge.search || edge.hash) {
    throw new Error("Invalid PC REST relay origin");
  }
  const now = options.now ?? Date.now;
  const state = options.state ?? sharedState;

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), appOrigin);
    if (url.origin !== appOrigin || !url.pathname.startsWith("/api/pc-supabase/rest/v1/")) return fetcher(input, init);
    if (now() < state.bypassUntil) return fetcher(input, init);

    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const isRead = method === "GET" || method === "HEAD";
    const aborted = () => Boolean(init?.signal?.aborted || (input instanceof Request && input.signal.aborted));

    url.pathname = url.pathname.slice("/api/pc-supabase".length);
    url.protocol = edge.protocol;
    url.host = edge.host;
    // No cookies at the cross-origin relay; the SDK supplies the member Bearer JWT.
    const viaRelay = () =>
      input instanceof Request
        ? fetcher(new Request(url, new Request(input, init)), { credentials: "omit", redirect: "error" })
        : fetcher(url.href, { ...init, credentials: "omit", redirect: "error" });

    let response: Response;
    try {
      response = await viaRelay();
    } catch (error) {
      if (aborted()) throw error;
      state.bypassUntil = now() + RELAY_BYPASS_MS;
      if (isRead) return fetcher(input, init);
      throw error;
    }
    if (RELAY_UNAVAILABLE.has(response.status)) {
      state.bypassUntil = now() + RELAY_BYPASS_MS;
      if (isRead) {
        await response.body?.cancel().catch(() => {});
        return fetcher(input, init);
      }
    }
    return response;
  };
}
