/** Per-client, confirmed refresh-rate-limit protection. Never shares successful POSTs. */
export function createCloudAuthFetch(fetcher: typeof fetch, cloudUrl: string): typeof fetch {
  const base = new URL(cloudUrl);
  const tokenPath = `${base.pathname.replace(/\/$/, "")}/auth/v1/token`;
  const origin = base.origin;
  let failure: { key: string; until: number; response: Response } | undefined;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.origin !== origin || url.pathname !== tokenPath || url.searchParams.get("grant_type") !== "refresh_token" || method !== "POST") {
      return fetcher(input, init);
    }
    const body = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
    // SDK refresh bodies are short JSON. Other callers retain their original transport.
    if (body.length > 16_384) return fetcher(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    const key = JSON.stringify([url.href, body, headers.get("authorization"), headers.get("apikey")]);
    if (failure?.key === key && Date.now() < failure.until) return failure.response.clone();
    const response = await fetcher(input, init);
    if (response.status !== 429) { failure = undefined; return response; }
    // auth-js treats 503 as retryable and preserves cookies; it does not honor Retry-After.
    // Cache only this explicit refusal through its <=30s retry window, without another dispatch.
    const retryAfter = response.headers.get("retry-after");
    const delay = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000
      : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
    const until = Date.now() + Math.max(60_000, Math.min(300_000, Number.isFinite(delay) ? delay : 0));
    const reader = response.body?.getReader(), chunks: Uint8Array[] = [];
    let length = 0, oversized = false;
    if (reader) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Auth refusal body unavailable")), 3000); });
      try {
        while (true) {
          const { done, value } = await Promise.race([reader.read(), deadline]);
          if (done) break;
          length += value.length;
          if (length > 16_384) { oversized = true; void reader.cancel().catch(() => undefined); break; }
          chunks.push(value);
        }
      } catch { oversized = true; void reader.cancel().catch(() => undefined); }
      finally { clearTimeout(timer); reader.releaseLock(); }
    }
    const output = new Uint8Array(length <= 16_384 ? length : 0);
    let offset = 0;
    for (const chunk of chunks) { if (!oversized) { output.set(chunk, offset); offset += chunk.length; } }
    const resultHeaders = new Headers(response.headers);
    // fetch provides decoded bytes; the original wire framing no longer describes this body.
    resultHeaders.delete("content-length"); resultHeaders.delete("content-encoding");
    if (oversized) resultHeaders.set("content-type", "application/json");
    const mapped = new Response(oversized ? '{"message":"Auth refresh temporarily rate limited","code":"over_request_rate_limit"}' : output,
      { status: 503, statusText: "Service Unavailable", headers: resultHeaders });
    failure = { key, until, response: mapped };
    return mapped.clone();
  };
}
