import type { CloudAuth } from "./supabase/cloud-auth";

const reservedPorts = new Set([8000, 3008, 3109, 3112]);

export function syntheticLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return value === url.origin && url.protocol === "http:" && url.hostname === "127.0.0.1" &&
      Number(url.port) >= 1024 && Number(url.port) <= 65535 && !reservedPorts.has(Number(url.port));
  } catch { return false; }
}

/** Public build settings; no server keys or loopback data endpoint are imported into the browser. */
export function pcAppCloudAuthConfig(): CloudAuth {
  const url = process.env.NEXT_PUBLIC_CLOUD_AUTH_URL;
  const anonKey = process.env.NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY;
  const synthetic = process.env.NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW === "true";
  let parsed: URL;
  try { parsed = new URL(url!); } catch { throw new Error("Explicit PC app cloud Auth required"); }
  const httpsRoot = parsed.protocol === "https:" && parsed.origin === url && !parsed.username && !parsed.password;
  const trustedHost = synthetic
    ? httpsRoot && /(?:\.example\.test|\.localhost)$/.test(parsed.hostname) || syntheticLoopbackOrigin(url!)
    : httpsRoot && /^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname);
  if (!trustedHost || !anonKey || /[\s]/.test(anonKey) ||
      (synthetic ? process.env.NEXT_PUBLIC_CLOUD_AUTH_MODE !== "test" : process.env.NEXT_PUBLIC_CLOUD_AUTH_MODE === "test")) {
    throw new Error("Explicit PC app cloud Auth required");
  }
  return { url: url!, anonKey };
}

export function isPcAppCloudDataRequest(input: RequestInfo | URL, cloud: CloudAuth): boolean {
  const source = new URL(input instanceof Request ? input.url : String(input));
  return source.origin === new URL(cloud.url).origin && /^\/(rest|storage|functions)\/v1(?:\/|$)/.test(source.pathname);
}

/** Split one cloud issuer from PC data. A failure is returned once, without a second destination. */
export function createPcAppDataFetch(
  fetcher: typeof fetch,
  cloud: CloudAuth,
  dataBase: string,
  rewriteHeaders?: (headers: Headers) => void,
): typeof fetch {
  const base = new URL(dataBase);
  if (base.pathname !== "/api/pc-supabase" || base.search || base.hash || base.username || base.password) {
    throw new Error("PC app data requires its same-origin API");
  }
  return (input, init) => {
    const source = new URL(input instanceof Request ? input.url : String(input));
    if (!isPcAppCloudDataRequest(input, cloud)) {
      return fetcher(input, init);
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    rewriteHeaders?.(headers);
    const target = `${base.origin}${base.pathname}${source.pathname}${source.search}`;
    if (input instanceof Request) return fetcher(new Request(target, new Request(input, { ...init, headers })));
    return fetcher(target, { ...init, headers });
  };
}
