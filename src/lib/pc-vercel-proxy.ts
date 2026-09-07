import { NextResponse, type NextRequest } from "next/server";

const blocked = /^\/(?:api\/(?:google|sheets|schedule-sheets|menu-sheets|push|cron|legacy-access|admin\/services)(?:\/|$)|auth(?:\/|$)|sw\.js$)/;
const excludedHeaders = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"]);
const imageReadPaths = new Set(["/api/avatar/image", "/api/note-image", "/api/tweet-image"]);

function bridgeBase() {
  const base = process.env.PC_TRIAL_BRIDGE_URL;
  const key = process.env.PC_TRIAL_BRIDGE_KEY;
  if (!base || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/_pc\/bridge$/.test(base) || !key || key.length < 32) throw new Error("Private bridge configuration missing");
  return { base, key };
}

/** An independent Vercel trial keeps the existing one-owner gate on the PC. */
export async function pcVercelProxy(request: NextRequest): Promise<NextResponse | null> {
  const path = request.nextUrl.pathname;
  const { base, key } = bridgeBase();
  const headers = new Headers({ "x-pc-trial-bridge": key, "x-pc-trial-browser": "1" });
  headers.set("cookie", request.headers.get("cookie") ?? "");
  if (path === "/login") return NextResponse.redirect(new URL("/_pc/login", request.url));

  const imageRead = imageReadPaths.has(path) && ['GET', 'HEAD'].includes(request.method);
  if (path.startsWith("/_pc/") || imageRead) {
    if (!imageRead && !["/_pc/login", "/_pc/logout"].includes(path) && !path.startsWith("/_pc/supabase/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.get("origin") !== `https://${request.headers.get("host")}`) return NextResponse.json({ error: "Origin denied" }, { status: 403 });
    for (const name of ["authorization", "apikey", "content-type", "prefer", "range", "range-unit", "accept", "accept-profile", "content-profile"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
    if (body && body.byteLength > 1024 * 1024) return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const upstream = await fetch(`${base}${path}${request.nextUrl.search}`, { method: request.method, headers, body, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(25000) });
    const outgoing = new Headers();
    upstream.headers.forEach((value, name) => { if (!excludedHeaders.has(name)) outgoing.set(name, value); });
    const location = outgoing.get("location");
    // Next's Proxy adapter requires absolute redirects, unlike a plain HTTP server.
    if (location?.startsWith("/")) outgoing.set("location", new URL(location, request.url).href);
    for (const cookie of upstream.headers.getSetCookie()) outgoing.append("set-cookie", cookie);
    outgoing.set("cache-control", "no-store, private");
    outgoing.set("x-pc-trial-app", "vercel");
    return new NextResponse(upstream.body, { status: upstream.status, headers: outgoing });
  }
  const session = await fetch(`${base}/_pc/session`, { headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10000) });
  if (!session.ok) {
    if (session.status !== 401) return NextResponse.json({ error: "PCに接続できません" }, { status: 503 });
    if (request.method === "GET" && !path.startsWith("/api/")) return NextResponse.redirect(new URL("/_pc/login", request.url));
    return NextResponse.json({ error: "本人専用ログインが必要です" }, { status: 401 });
  }
  if (blocked.test(path)) return NextResponse.json({ error: "試験版では外部連携を停止しています" }, { status: 403 });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get("origin") !== `https://${request.headers.get("host")}`) return NextResponse.json({ error: "Origin denied" }, { status: 403 });
  return null;
}
