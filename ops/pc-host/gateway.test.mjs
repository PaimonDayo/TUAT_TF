import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createGateway } from './gateway.mjs';

async function fixture(fn, options = {}) {
  const records = [];
  const app = http.createServer(fn ?? ((req, res) => {
    records.push({ headers: req.headers, method: req.method });
    res.setHeader('set-cookie', ['one=a; HttpOnly', 'two=b; HttpOnly']); res.end('ok');
  }));
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const gateway = createGateway({ publicOrigin: 'https://pc.example.test', appPort: app.address().port, ...options });
  gateway.server.listen(0, '127.0.0.1'); await once(gateway.server, 'listening');
  return { records, url: `http://127.0.0.1:${gateway.server.address().port}`, close: async () => { await gateway.close(); await new Promise(resolve => app.close(resolve)); } };
}
test('canonical host and cookies preserved; internal headers stripped', async () => {
  const f = await fixture(); try {
    const r = await fetch(f.url + '/home?x=1', { headers: { 'x-forwarded-host': 'evil.invalid', 'x-pc-backend-key': 'untrusted', cookie: 'session=valid' } });
    assert.equal(r.status, 200); assert.equal(await r.text(), 'ok'); assert.equal(r.headers.getSetCookie().length, 2);
    assert.equal(f.records[0].headers.host, 'pc.example.test'); assert.equal(f.records[0].headers.cookie, 'session=valid'); assert.equal(f.records[0].headers['x-pc-backend-key'], undefined);
  } finally { await f.close(); }
});
test('foreign and missing Origin writes rejected before app dispatch', async () => {
  const f = await fixture(); try {
    for (const headers of [{}, { origin: 'https://evil.invalid' }]) assert.equal((await fetch(f.url, { method: 'POST', headers, body: 'x' })).status, 403);
    assert.equal(f.records.length, 0);
  } finally { await f.close(); }
});
test('body cap applied and accepted write sent only once', async () => {
  const f = await fixture(undefined, { maxBodyBytes: 4 }); try {
    assert.equal((await fetch(f.url, { method: 'POST', headers: { origin: 'https://pc.example.test' }, body: 'oversize' })).status, 413);
    assert.equal(f.records.length, 0);
    assert.equal((await fetch(f.url, { method: 'POST', headers: { origin: 'https://pc.example.test' }, body: 'ok' })).status, 200);
    assert.equal(f.records.length, 1);
  } finally { await f.close(); }
});
test('committed write followed by disconnect is never replayed', async () => {
  let writes = 0;
  const f = await fixture((req) => { req.on('end', () => { writes++; req.socket.destroy(); }); req.resume(); }); try {
    const r = await fetch(f.url, { method: 'POST', headers: { origin: 'https://pc.example.test' }, body: 'save' });
    assert.equal(r.status, 503); assert.equal(writes, 1);
  } finally { await f.close(); }
});
test('undeclared chunked overflow never partially dispatches a write', async () => {
  const f = await fixture(undefined, { maxBodyBytes: 4 }); try {
    const status = await new Promise((resolve, reject) => {
      const request = http.request(f.url, { method: 'POST', headers: { origin: 'https://pc.example.test' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject); request.write('ok'); request.end('oversize');
    });
    assert.equal(status, 413); assert.equal(f.records.length, 0);
  } finally { await f.close(); }
});
test('upstream deadline does not replay a timed out write', async () => {
  let writes = 0;
  const f = await fixture(req => { writes++; req.resume(); }, { requestTimeoutMs: 75 }); try {
    const r = await fetch(f.url, { method: 'POST', headers: { origin: 'https://pc.example.test' }, body: 'save' });
    assert.equal(r.status, 504); assert.equal(writes, 1);
  } finally { await f.close(); }
});
test('RSC response begins before upstream body completes', async () => {
  let finish;
  const f = await fixture((_req, res) => { res.writeHead(200, { 'content-type': 'text/x-component' }); res.write('first'); finish = () => res.end('last'); }); try {
    const r = await fetch(f.url); const reader = r.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'first'); finish();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'last');
  } finally { finish?.(); await f.close(); }
});
test('incomplete upstream body terminates downstream without replay', async () => {
  let calls = 0;
  const f = await fixture((_req, res) => { calls++; res.writeHead(200, { 'content-length': '100' }); res.write('first'); setTimeout(() => res.socket.destroy(), 20); }); try {
    const r = await fetch(f.url);
    await assert.rejects(r.text()); assert.equal(calls, 1);
  } finally { await f.close(); }
});
test('untrusted proxy/private and hop headers are removed both ways', async () => {
  let headers;
  const f = await fixture((req, res) => { headers = req.headers; res.setHeader('x-pc-app-key', 'fixture-only'); res.setHeader('connection', 'x-private-hop'); res.setHeader('x-private-hop', 'fixture-only'); res.end('ok'); }); try {
    const r = await new Promise((resolve, reject) => {
      const request = http.get(f.url, { headers: { 'x-forwarded-port': 'evil', 'x-tuat-app-public-origin': 'https://evil.invalid', 'x-vercel-protection-bypass': 'fixture-only', connection: 'x-private-hop', 'x-private-hop': 'fixture-only' } }, response => { response.resume(); response.on('end', () => resolve(response)); }); request.on('error', reject);
    });
    assert.equal(r.statusCode, 200);
    assert.equal(headers['x-forwarded-port'], '443'); assert.equal(headers['x-tuat-app-public-origin'], undefined); assert.equal(headers['x-private-hop'], undefined); assert.equal(headers['x-vercel-protection-bypass'], undefined);
    assert.equal(r.headers['x-pc-app-key'], undefined); assert.equal(r.headers['x-private-hop'], undefined);
  } finally { await f.close(); }
});
