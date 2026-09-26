// Browser REST only. Auth/OAuth and SSR retain the established Vercel transport.
import { jobsHealth } from './jobs-health.mjs';
const methods = ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'];
const incoming = ['authorization', 'apikey', 'content-type', 'accept', 'prefer', 'range', 'range-unit', 'accept-profile', 'content-profile', 'x-client-info', 'x-retry-count'];
const outgoing = ['content-type', 'content-range', 'range-unit', 'preference-applied', 'retry-after', 'www-authenticate'];
// PCの接続先が無い（PCが止まっている）ときに付ける。要求はPCへ届いていないので、アプリはクラウドへ送り直してよい。
const MODE_HEADER = 'x-tuat-backend';
const encoder = new TextEncoder();
function member(value) {
  try {
    if (!value?.startsWith('Bearer ')) return false;
    const parts = value.slice(7).split('.');
    if (parts.length !== 3) return false;
    const claims = JSON.parse(atob(parts[1].replaceAll('-', '+').replaceAll('_', '/')));
    // Boundary role filter only. Supabase still verifies signature, expiry and RLS.
    return claims.role === 'authenticated' && /^[a-f0-9-]{36}$/i.test(claims.sub ?? '');
  } catch { return false; }
}
async function endpoint(env) {
  const object = await env.ENDPOINTS.get(`ops/pc-backend/${env.PC_BACKEND_INSTANCE_ID}/endpoint.json`);
  if (!object || object.size > 4096) throw Error('Unavailable');
  const data = JSON.parse(await object.text());
  const now = Date.now();
  if (data.version !== 1 || data.instanceId !== env.PC_BACKEND_INSTANCE_ID ||
      !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(data.origin) ||
      !Number.isFinite(data.expiresAt) || data.expiresAt <= now || data.expiresAt > now + 300000 ||
      !/^[a-f0-9]{64}$/.test(data.signature) || (env.PC_BACKEND_BRIDGE_KEY?.length ?? 0) < 32) throw Error('Unavailable');
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.PC_BACKEND_BRIDGE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signature = Uint8Array.from(data.signature.match(/../g), x => parseInt(x, 16));
  if (!await crypto.subtle.verify('HMAC', key, signature, encoder.encode(JSON.stringify([1, data.origin, data.instanceId, data.expiresAt])))) throw Error('Unavailable');
  return data;
}
export function createRelay(fetchUpstream = fetch) { return {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/jobs-health') return jobsHealth(request, env);
    const headers = new Headers({ 'cache-control': 'private, no-store', 'vary': 'Origin', 'x-content-type-options': 'nosniff' });
    const reply = (status, error) => {
      if (error) headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(error ? JSON.stringify({ error }) : null, { status, headers });
    };
    const origin = request.headers.get('origin');
    if (!env.APP_ORIGIN || origin !== env.APP_ORIGIN) return reply(403, 'Origin denied');
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-expose-headers', [...outgoing, MODE_HEADER].join(', '));
    const url = new URL(request.url);
    if (!/^\/rest\/v1\/.+/.test(url.pathname) || /%(?:2f|5c|2e)|\\/i.test(url.pathname)) return reply(403, 'Operation denied');
    if (request.method === 'OPTIONS') {
      const wanted = request.headers.get('access-control-request-headers')?.toLowerCase().split(',').map(x => x.trim()).filter(Boolean) ?? [];
      if (!methods.includes(request.headers.get('access-control-request-method')) || wanted.some(x => !incoming.includes(x))) return reply(403, 'Preflight denied');
      headers.set('access-control-allow-methods', methods.join(', '));
      headers.set('access-control-allow-headers', incoming.join(', '));
      headers.set('access-control-max-age', '600');
      return reply(204);
    }
    if (!methods.includes(request.method)) return reply(405, 'Method denied');
    if (!member(request.headers.get('authorization'))) return reply(401, 'Login required');
    try {
      let body;
      if (!['GET', 'HEAD'].includes(request.method)) {
        if (Number(request.headers.get('content-length') ?? 0) > 1048576) return reply(413, 'Request too large');
        const reader = request.body?.getReader();
        const chunks = []; let size = 0;
        if (reader) for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1048576) { await reader.cancel(); return reply(413, 'Request too large'); }
          chunks.push(value);
        }
        body = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      }
      let target;
      try { target = await endpoint(env); } catch {
        headers.set(MODE_HEADER, 'cloud');
        headers.set('retry-after', '30');
        return reply(503, 'データ保存先に接続できません。しばらく待ってから再度お試しください。');
      }
      const send = new Headers({ apikey: env.SUPABASE_ANON_KEY, 'x-pc-backend-key': env.PC_BACKEND_BRIDGE_KEY });
      for (const name of incoming) {
        if (name === 'apikey') continue;
        const value = request.headers.get(name); if (value) send.set(name, value);
      }
      const result = await fetchUpstream(`${target.origin}/backend${url.pathname}${url.search}`, {
        method: request.method, headers: send, body, redirect: 'manual', cache: 'no-store',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]),
      });
      // REST must not redirect JWTs to another host. Never retry a failed request.
      if (result.status >= 300 && result.status < 400) { await result.body?.cancel(); return reply(502, 'Unexpected redirect'); }
      for (const name of outgoing) { const value = result.headers.get(name); if (value) headers.set(name, value); }
      return new Response(result.body, { status: result.status, headers });
    } catch {
      headers.set('retry-after', '30');
      return reply(503, 'データ保存先に接続できません。しばらく待ってから再度お試しください。');
    }
  },
}; }
export default createRelay();
