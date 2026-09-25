/** Route only PostgREST to the optional edge relay. Auth URL/cookies stay unchanged. */
export function createPcBrowserTransport(fetcher: typeof fetch, appOrigin: string, relay?: string): typeof fetch {
  if (!relay) return fetcher;
  const edge = new URL(relay);
  if (edge.protocol !== "https:" || edge.username || edge.password || edge.pathname !== "/" || edge.search || edge.hash) {
    throw new Error("Invalid PC REST relay origin");
  }
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), appOrigin);
    if (url.origin !== appOrigin || !url.pathname.startsWith("/api/pc-supabase/rest/v1/")) return fetcher(input, init);
    url.pathname = url.pathname.slice("/api/pc-supabase".length);
    url.protocol = edge.protocol;
    url.host = edge.host;
    // No cookies at the cross-origin relay; the SDK supplies the member Bearer JWT.
    // Never fall back/replay a failed write: it may already have committed.
    if (input instanceof Request) return fetcher(new Request(url, new Request(input, init)), { credentials: "omit", redirect: "error" });
    return fetcher(url.href, { ...init, credentials: "omit", redirect: "error" });
  };
}
