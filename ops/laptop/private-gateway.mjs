import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { parse, serialize } from 'cookie';

const gateCookie = '__Host-pc-trial';
const lifetime = 12 * 60 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest();
const safePassword = (a, b) => timingSafeEqual(digest(a), digest(b));
const blockedApp = /^\/(?:api\/(?:google|sheets|schedule-sheets|menu-sheets|push|cron|legacy-access|admin\/services)(?:\/|$)|auth(?:\/|$)|sw\.js$)/;
const hopHeaders = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer']);
const imageReadPaths = new Set(['/api/avatar/image', '/api/note-image', '/api/tweet-image']);

export function createPrivateGateway(config, { authenticate, validateUser } = {}) {
  const origin = new URL(config.origin);
  if (origin.protocol !== 'https:' && !(origin.hostname === '127.0.0.1' && config.testOnly)) throw Error('HTTPS required');
  if (config.password.length < 24 || !config.userId || !config.email) throw Error('Missing private trial owner');
  if (config.bridgeKey && config.bridgeKey.length < 32) throw Error('Invalid server bridge key');
  const app = new URL(config.appUrl ?? 'http://127.0.0.1:3009');
  const api = new URL(config.apiUrl ?? 'http://127.0.0.1:8000');
  if ([app, api].some(u => u.hostname !== '127.0.0.1' || u.protocol !== 'http:')) throw Error('Loopback upstreams only');
  const sessions = new Map();
  const failures = new Map();
  const authenticateOwner = authenticate ?? (async password => {
    const cookies = new Map();
    const sb = createServerClient(api.origin, config.anonKey, {
      cookieOptions: { name: 'sb-pc-trial-auth', secure: true, sameSite: 'lax' },
      cookies: { getAll: () => [], setAll: values => values.forEach(c => cookies.set(c.name, c)) },
    });
    const result = await sb.auth.signInWithPassword({ email: config.email, password });
    if (result.error || result.data.user?.id !== config.userId) throw Error('Authentication failed');
    return [...cookies.values()].map(c => serialize(c.name, c.value, { ...c.options, secure: true }));
  });
  const checkUser = validateUser ?? (async token => {
    const result = await fetch(`${api.origin}/auth/v1/user`, { headers: { apikey: config.anonKey, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    return result.ok && (await result.json()).id === config.userId;
  });
  function reply(res, status, body, type = 'application/json; charset=utf-8') {
    // no-referrer makes native form POSTs send Origin: null. Keep same-origin
    // form origins while still withholding referrers from external sites.
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': "frame-ancestors 'none'" });
    res.end(body);
  }
  function loginPage(res, failed = false) {
    reply(res, failed ? 401 : 200, `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PC試験版 — 本人専用</title><style>body{font:16px system-ui;background:#f3f6fb;color:#17233b;margin:0;padding:24px}main{max-width:390px;margin:12vh auto;background:white;padding:28px;border-radius:20px;box-shadow:0 10px 35px #1231}h1{font-size:24px}p{line-height:1.7;color:#536077}label{display:block;margin-top:24px}input,button{box-sizing:border-box;width:100%;padding:14px;border-radius:12px;font:inherit;margin-top:8px}input{border:1px solid #b8c5d8}button{background:#1769e0;border:0;color:white;font-weight:600}.error{color:#b42318}</style><main><p>本人限定 · PCで実行中</p><h1>PC試験版</h1><p>入力・編集はPC内のコピーに保存します。本番の投稿やスプレッドシートには反映されません。</p>${failed ? '<p class="error" role="alert">ログインできませんでした。専用パスワードを確認してください。</p>' : ''}<form method="post" action="/_pc/login"><label>PC版専用パスワード<input type="password" name="password" required autocomplete="current-password" maxlength="256"></label><button type="submit">試験版を開く</button></form><p><small>本番のGoogleパスワードは入力しないでください。</small></p></main></html>`, 'text/html; charset=utf-8');
  }
  function hasSession(req) {
    const key = parse(req.headers.cookie ?? '')[gateCookie];
    if (!key) return false;
    const expiration = sessions.get(key);
    if (!expiration || expiration <= Date.now()) { sessions.delete(key); return false; }
    return true;
  }
  function sameOrigin(req) { return req.headers.origin === origin.origin; }
  async function readBody(req, limit = 2048) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw Error('Body too large'); chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  }
  function proxy(req, res, upstream, path) {
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !hopHeaders.has(k) && !k.startsWith('x-forwarded-') && !k.startsWith('x-pc-trial-') && k !== 'forwarded' && k !== 'host'));
    headers.host = origin.host;
    headers['x-forwarded-host'] = origin.host;
    headers['x-forwarded-proto'] = 'https';
    const upstreamRequest = http.request({ hostname: upstream.hostname, port: upstream.port, path, method: req.method, headers, timeout: 30000 }, response => {
      const outgoing = Object.fromEntries(Object.entries(response.headers).filter(([k]) => !hopHeaders.has(k) && k !== 'access-control-allow-origin' && k !== 'access-control-allow-credentials'));
      outgoing['cache-control'] = 'no-store, private';
      outgoing['x-robots-tag'] = 'noindex, nofollow';
      outgoing['referrer-policy'] = 'same-origin';
      outgoing['content-security-policy'] = "frame-ancestors 'none'";
      if (outgoing.location?.startsWith(app.origin)) outgoing.location = origin.origin + outgoing.location.slice(app.origin.length);
      if (outgoing.location?.startsWith('http://localhost:3009')) outgoing.location = origin.origin + outgoing.location.slice('http://localhost:3009'.length);
      res.writeHead(response.statusCode ?? 502, outgoing);
      response.pipe(res);
    });
    upstreamRequest.on('timeout', () => upstreamRequest.destroy());
    upstreamRequest.on('error', () => { if (!res.headersSent) reply(res, 502, '{"error":"PC試験版に接続できません"}'); else res.destroy(); });
    req.on('aborted', () => upstreamRequest.destroy());
    req.pipe(upstreamRequest);
  }
  const server = http.createServer(async (req, res) => {
    try {
      // Reject encoded separators, dot segments and backslashes before dispatch.
      const raw = req.url ?? '/';
      if (/%(?:2f|5c|2e)|\\|(?:^|\/)\.{1,2}(?:\/|\?|$)/i.test(raw.split('?')[0])) return reply(res, 400, '{"error":"Invalid path"}');
      let url = new URL(raw, origin);
      if (url.origin !== origin.origin) return reply(res, 400, '{"error":"Invalid origin"}');
      const bridge = url.pathname.startsWith('/_pc/bridge/');
      if (bridge) {
        if (!config.bridgeKey || !safePassword(req.headers['x-pc-trial-bridge'] ?? '', config.bridgeKey)) return reply(res, 401, '{"error":"Private bridge required"}');
        url = new URL(url.pathname.slice('/_pc/bridge'.length) + url.search, origin);
        if (!['/_pc/login', '/_pc/logout', '/_pc/session'].includes(url.pathname) && !url.pathname.startsWith('/_pc/supabase/') && !(imageReadPaths.has(url.pathname) && ['GET', 'HEAD'].includes(req.method))) return reply(res, 403, '{"error":"Bridge route denied"}');
      }
      if (!bridge && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) return reply(res, 403, '{"error":"Origin denied"}');
      if (url.pathname === '/_pc/login' || url.pathname === '/login') {
        if (req.method === 'GET') return loginPage(res);
        if (req.method !== 'POST') return reply(res, 405, '{}');
        // Global bound is intentional: only one person should ever log in here.
        const now = Date.now();
        for (const [key, time] of failures) if (time < now - 15 * 60 * 1000) failures.delete(key);
        if (failures.size >= 8) return reply(res, 429, '{"error":"しばらく待ってからお試しください"}');
        failures.set(randomBytes(8).toString('hex'), now);
        const password = new URLSearchParams(await readBody(req)).get('password') ?? '';
        if (!safePassword(password, config.password)) return loginPage(res, true);
        const authCookies = await authenticateOwner(password);
        for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key);
        if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
        const session = randomBytes(32).toString('base64url');
        sessions.set(session, now + lifetime);
        failures.clear();
        res.writeHead(303, { location: '/home', 'cache-control': 'no-store', 'set-cookie': [...authCookies, serialize(gateCookie, session, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: lifetime / 1000 })] });
        return res.end();
      }
      const serverApi = bridge && req.headers['x-pc-trial-browser'] !== '1' && url.pathname.startsWith('/_pc/supabase/');
      if (!serverApi && !hasSession(req)) {
        if (req.method === 'GET' && (url.pathname === '/' || req.headers.accept?.includes('text/html'))) { res.writeHead(303, { location: '/_pc/login', 'cache-control': 'no-store' }); return res.end(); }
        return reply(res, 401, '{"error":"本人専用ログインが必要です"}');
      }
      if (url.pathname === '/_pc/session') return reply(res, req.method === 'GET' ? 200 : 405, '{}');
      if (url.pathname === '/_pc/logout') {
        if (req.method !== 'POST') return reply(res, 405, '{}');
        const cookies = parse(req.headers.cookie ?? '');
        sessions.delete(cookies[gateCookie]);
        const names = [gateCookie, ...Object.keys(cookies).filter(name => name.startsWith('sb-pc-trial-auth'))];
        res.writeHead(303, { location: '/_pc/login', 'cache-control': 'no-store', 'set-cookie': names.map(name => serialize(name, '', { path: '/', secure: true, httpOnly: name === gateCookie, sameSite: 'lax', maxAge: 0 })) });
        return res.end();
      }
      if (url.pathname.startsWith('/_pc/supabase')) {
        const path = url.pathname.slice('/_pc/supabase'.length);
        if (!/^\/(?:rest|auth|storage)\/v1(?:\/|$)/.test(path)) return reply(res, 403, '{"error":"API denied"}');
        // No signup, external OAuth, admin API, Edge Functions or Storage writes.
        if (path.startsWith('/auth/') && !(path === '/auth/v1/user' && req.method === 'GET') && !(path === '/auth/v1/token' && req.method === 'POST' && url.searchParams.get('grant_type') === 'refresh_token') && !(path === '/auth/v1/logout' && req.method === 'POST')) return reply(res, 403, '{"error":"Auth operation denied"}');
        if (path.startsWith('/storage/') && !['GET', 'HEAD'].includes(req.method)) return reply(res, 403, '{"error":"Images are read-only"}');
        if (path === '/auth/v1/token') {
          const body = await readBody(req, 16384);
          const result = await fetch(`${api.origin}${path}${url.search}`, {
            method: 'POST', headers: { apikey: config.anonKey, 'content-type': 'application/json' },
            body, signal: AbortSignal.timeout(10000), redirect: 'manual',
          });
          const data = await result.json();
          if (result.ok && data.user?.id !== config.userId) return reply(res, 403, '{"error":"Owner account required"}');
          return reply(res, result.status, JSON.stringify(data));
        } else {
          const token = req.headers.authorization?.replace(/^Bearer /i, '') ?? '';
          if (!token || !(await checkUser(token))) return reply(res, 403, '{"error":"Owner account required"}');
        }
        return proxy(req, res, api, path + url.search);
      }
      if (blockedApp.test(url.pathname)) return reply(res, 403, '{"error":"PC試験版では外部連携を停止しています"}');
      return proxy(req, res, app, url.pathname + url.search);
    } catch { if (!res.headersSent) reply(res, 400, '{"error":"リクエストを処理できませんでした"}'); else res.destroy(); }
  });
  // Realtime is deliberately off during this isolated trial; normal reads/writes work.
  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'));
  server.requestTimeout = 30000;
  return server;
}
