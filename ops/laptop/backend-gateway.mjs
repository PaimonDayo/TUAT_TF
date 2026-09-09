import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

const equal = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());

export function createBackendGateway({ key, instanceId, api = 'http://127.0.0.1:8000', isMaintenance = () => false }) {
  if (!key || key.length < 32 || !instanceId) throw new Error('Backend configuration missing');
  const upstream = new URL(api);
  if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1') throw new Error('Backend must be loopback');
  const server = http.createServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (!equal(req.headers['x-pc-backend-key'] ?? '', key)) return reply(401, { error: 'Unauthorized' });
    const raw = req.url ?? '';
    if (!raw.startsWith('/') || /%(?:2e|2f|5c)|\\|(?:^|\/)\.{1,2}(?:\/|\?|$)/i.test(raw.split('?')[0])) return reply(400, { error: 'Invalid path' });
    const url = new URL(raw, upstream);
    if (url.origin !== upstream.origin) return reply(400, { error: 'Invalid destination' });
    if (url.pathname === '/health' && req.method === 'GET') return reply(200, { instanceId, maintenance: isMaintenance() });
    if (!/^\/backend\/(auth|rest|storage|functions)\/v1(?:\/|$)/.test(url.pathname)) return reply(403, { error: 'API denied' });
    if (isMaintenance()) return reply(503, { error: 'メンテナンス中です。少し待ってから再度お試しください。' });
    if (Number(req.headers['content-length'] ?? 0) > 4_194_304) return reply(413, { error: 'Request too large' });
    const headers = {};
    for (const name of ['authorization', 'apikey', 'content-type', 'accept', 'prefer', 'range', 'range-unit', 'accept-profile', 'content-profile', 'x-client-info', 'content-length']) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
    const target = http.request(new URL(url.pathname.slice('/backend'.length) + url.search, upstream), { method: req.method, headers, timeout: 25_000 }, response => {
      const outgoing = { ...response.headers, 'cache-control': 'private, no-store' };
      delete outgoing['access-control-allow-origin'];
      res.writeHead(response.statusCode ?? 502, outgoing);
      response.pipe(res);
    });
    let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 4_194_304) { target.destroy(); req.destroy(); } });
    req.on('aborted', () => target.destroy());
    target.on('timeout', () => target.destroy());
    target.on('error', () => { if (!res.headersSent) reply(502, { error: 'Backend unavailable' }); else res.destroy(); });
    req.pipe(target);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n'));
  return server;
}
