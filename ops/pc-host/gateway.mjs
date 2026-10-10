import http from 'node:http';

function forwardedHeaders(input) {
  const blocked = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','forwarded','x-real-ip','cf-connecting-ip', ...String(input.connection ?? '').toLowerCase().split(',').map(value => value.trim())]);
  return Object.fromEntries(Object.entries(input).filter(([name]) => !blocked.has(name) && !/^(?:x-forwarded-|x-pc-|x-tuat-|x-vercel-)/.test(name)));
}

// One loopback entry for a fixed Tunnel. No endpoint discovery or standby replay.
export function createGateway({ publicOrigin, appPort, maxBodyBytes = 8 * 1024 * 1024,
  requestTimeoutMs = 330_000, drainTimeoutMs = 335_000 }) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin) throw Error('Fixed HTTPS origin required');
  if (!Number.isInteger(appPort) || appPort < 1024 || appPort > 65535) throw Error('Dedicated app port required');
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || !Number.isSafeInteger(drainTimeoutMs) || drainTimeoutMs < 1) throw Error('Bounded request limits required');
  let stopping = false;
  const active = new Set();
  const server = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const reply = (status) => {
      if (!res.headersSent) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store' }); res.end(JSON.stringify({ error: status === 413 ? 'Payload too large' : 'Request unavailable' })); }
      else res.destroy();
    };
    if (stopping) return reply(503);
    const modifying = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (modifying && req.headers.origin !== publicOrigin) return reply(403);
    const length = req.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBodyBytes)) return reply(413);
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) return reply(400);
    // Validate complete bounded writes before dispatching them to the application.
    // RSC responses remain streamed; request buffering is limited to this cap.
    const chunks = [];
    let received = 0;
    const bodyDeadline = setTimeout(() => { reply(408); req.destroy(); }, requestTimeoutMs);
    try {
      for await (const chunk of req) {
        received += chunk.length;
        if (received > maxBodyBytes) { clearTimeout(bodyDeadline); reply(413); return; }
        chunks.push(chunk);
      }
    } catch { clearTimeout(bodyDeadline); reply(400); return; }
    clearTimeout(bodyDeadline);
    const headers = { ...forwardedHeaders(req.headers), host: origin.host, 'x-forwarded-host': origin.host, 'x-forwarded-proto': 'https', 'x-forwarded-port': origin.port || '443' };
    if (chunks.length) headers['content-length'] = String(received);
    const upstream = http.request({ hostname: '127.0.0.1', port: appPort, path: req.url, method: req.method, headers }, (response) => {
      response.on('error', () => res.destroy());
      response.on('aborted', () => res.destroy());
      response.on('close', () => { if (!response.complete) res.destroy(); });
      res.writeHead(response.statusCode ?? 502, forwardedHeaders(response.headers));
      response.pipe(res);
    });
    active.add(upstream);
    const deadline = setTimeout(() => { reply(504); upstream.destroy(); }, Math.max(1, requestTimeoutMs - (Date.now() - startedAt)));
    const cleanup = () => { clearTimeout(deadline); active.delete(upstream); };
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); cleanup(); });
    upstream.on('error', () => { reply(503); cleanup(); });
    req.on('aborted', () => upstream.destroy());
    upstream.end(chunks.length ? Buffer.concat(chunks, received) : undefined);
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = requestTimeoutMs;
  server.maxHeadersCount = 100;
  const close = async () => {
    stopping = true;
    const timeout = setTimeout(() => { for (const request of active) request.destroy(); server.closeAllConnections(); }, drainTimeoutMs);
    await new Promise((resolve) => server.close(resolve));
    clearTimeout(timeout);
  };
  return { server, close };
}
