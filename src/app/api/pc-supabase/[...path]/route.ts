import { pcBackendFetch } from "@/lib/pc-backend";
import { allowedPcBrowserApi, isMemberBearer } from "@/lib/pc-browser-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function handle(request: Request) {
  if (process.env.PC_BACKEND_ENABLED !== "true") return new Response(null, { status: 404 });
  const url = new URL(request.url);
  const path = url.pathname.slice("/api/pc-supabase".length);
  if (!allowedPcBrowserApi(path, request.method, url.searchParams)) return Response.json({ error: "Operation denied" }, { status: 403 });
  const read = ["GET", "HEAD"].includes(request.method);
  // Google uses GET for this callback. All client POSTs must originate from this app.
  if (!read && request.headers.get("origin") !== url.origin) return Response.json({ error: "Origin denied" }, { status: 403 });
  const auth = request.headers.get("authorization");
  if ((path.startsWith("/rest/") || path === "/auth/v1/user" || path === "/auth/v1/logout") && !isMemberBearer(auth)) {
    return Response.json({ error: "Login required" }, { status: 401 });
  }
  const headers = new Headers({ apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! });
  for (const name of ["content-type", "accept", "prefer", "range", "range-unit", "accept-profile", "content-profile", "x-client-info"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // An anon API key is acceptable for Auth token exchanges; privileged JWTs never cross this public route.
  if (isMemberBearer(auth)) headers.set("authorization", auth!);
  let body: Uint8Array | undefined;
  if (!read) {
    if (Number(request.headers.get("content-length") ?? 0) > 1_048_576) return new Response(null, { status: 413 });
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) { await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(value);
    }
    body = Buffer.concat(chunks);
  }
  try {
    const result = await pcBackendFetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}${path}${url.search}`, { method: request.method, headers, body: body as BodyInit | undefined });
    const out = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "same-origin" });
    for (const name of ["content-type", "content-range", "range-unit", "preference-applied", "retry-after", "www-authenticate"]) {
      const value = result.headers.get(name); if (value) out.set(name, value);
    }
    const location = result.headers.get("location");
    if (location) out.set("location", location);
    for (const cookie of result.headers.getSetCookie()) out.append("set-cookie", cookie);
    return new Response(result.body, { status: result.status, headers: out });
  } catch {
    return Response.json({ error: "データ保存先に接続できません。しばらく待ってから再度お試しください。" }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "30" } });
  }
}

export { handle as GET, handle as HEAD, handle as POST, handle as PATCH, handle as DELETE };
