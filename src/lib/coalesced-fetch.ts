/** Share only concurrent identical reads; never retain responses as a cache. */
export function createCoalescedFetch(fetcher: typeof fetch): typeof fetch {
  const pending = new Map<string, Promise<Response>>();
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      // Reads started after a write must not join a pre-write snapshot.
      pending.clear();
      try {
        return await fetcher(input, init);
      } finally {
        // A read begun during a write may still contain the old state when
        // the write completes; post-save refreshes must start a new request.
        pending.clear();
      }
    }
    // Independent cancellation must not cancel another caller's request.
    if (input instanceof Request || init?.signal) return fetcher(input, init);
    const headers = [...new Headers(init?.headers).entries()].sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify([String(input), method, headers, init?.credentials,
      init?.cache, init?.mode, init?.redirect, init?.referrer, init?.referrerPolicy,
      init?.integrity, init?.keepalive]);
    let request = pending.get(key);
    if (!request) {
      request = Promise.resolve().then(() => fetcher(input, init));
      pending.set(key, request);
    }
    try {
      return (await request).clone();
    } finally {
      if (pending.get(key) === request) pending.delete(key);
    }
  };
}
