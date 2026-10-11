// Local candidate: one native VPC Service, no endpoint discovery or retry.
export function canonicalPublicOrigin(value) {
  let origin;
  try { origin = new URL(value); } catch { throw Error('Canonical HTTPS APP_PUBLIC_ORIGIN required'); }
  if (typeof value !== 'string' || origin.protocol !== 'https:' || origin.origin !== value) {
    throw Error('Canonical HTTPS APP_PUBLIC_ORIGIN required');
  }
  return origin;
}

function unavailable(status = 503) {
  return Response.json({ error: status === 403 ? 'Request unavailable' : 'Service unavailable' }, {
    status, headers: { 'cache-control': 'private, no-store' },
  });
}

function removeProxyHeaders(headers) {
  const blocked = new Set([
    'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'forwarded', 'x-real-ip', 'cf-connecting-ip',
    ...String(headers.get('connection') ?? '').toLowerCase().split(',').map(value => value.trim()),
  ]);
  for (const name of [...headers.keys()]) {
    if (blocked.has(name) || /^(?:x-forwarded-|x-pc-|x-tuat-|x-vercel-)/.test(name)) headers.delete(name);
  }
}

const worker = {
  async fetch(request, env) {
    let origin;
    try {
      origin = canonicalPublicOrigin(env?.APP_PUBLIC_ORIGIN);
      if (typeof env?.PC_APP?.fetch !== 'function') return unavailable(500);
    } catch { return unavailable(500); }

    const target = new URL(request.url);
    if (target.origin !== origin.origin) return unavailable(403);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('origin') !== origin.origin) {
      return unavailable(403);
    }

    // The VPC Service pins the real loopback destination. This URL supplies Host.
    // HTTP is plaintext only from cloudflared to the gateway on this same PC.
    target.protocol = 'http:';
    try {
      const upstream = new Request(target, request);
      removeProxyHeaders(upstream.headers);
      // Return the original Response: keep its stream and distinct Set-Cookie headers.
      // Manual redirects reach the browser; never resend a possibly completed write.
      return await env.PC_APP.fetch(upstream, { redirect: 'manual' });
    } catch { return unavailable(); }
  },
};

export default worker;
