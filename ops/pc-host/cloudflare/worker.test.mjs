import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './worker.mjs';

const origin = 'https://pc-entry.review-account.workers.dev';
const encoder = new TextEncoder();
function environment(dispatch, publicOrigin = origin) {
  return { APP_PUBLIC_ORIGIN: publicOrigin, PC_APP: { fetch: dispatch } };
}
function request(path = '/', options) { return new Request(`${origin}${path}`, options); }

test('one POST dispatch preserves path/query, body, cookies, authorization and original Origin', async () => {
  let calls = 0;
  const upstreamResponse = new Response('saved', { status: 201 });
  const incoming = request('/api/pc-supabase/rest/v1/records?name=eq.a%2Fb&select=*,profile(id)', {
    method: 'POST', body: JSON.stringify({ value: '合成データ' }),
    headers: { origin, cookie: 'sb-tuat-auth=synthetic', authorization: 'Bearer synthetic', 'content-type': 'application/json' },
  });
  const response = await worker.fetch(incoming, environment(async (outgoing, options) => {
    calls++;
    assert.equal(outgoing.url, incoming.url.replace(/^https:/, 'http:'));
    assert.equal(outgoing.method, 'POST');
    assert.equal(outgoing.headers.get('origin'), origin);
    assert.equal(outgoing.headers.get('cookie'), 'sb-tuat-auth=synthetic');
    assert.equal(outgoing.headers.get('authorization'), 'Bearer synthetic');
    assert.deepEqual(await outgoing.json(), { value: '合成データ' });
    assert.equal(options.redirect, 'manual');
    return upstreamResponse;
  }));
  assert.equal(calls, 1);
  assert.equal(response, upstreamResponse);
});

test('forged proxy/internal headers and hop headers are removed, application headers remain', async () => {
  const incoming = request('/api/version', { headers: {
    host: 'attacker.invalid', forwarded: 'host=attacker.invalid', connection: 'x-hop, keep-alive',
    'x-hop': 'secret', 'x-forwarded-host': 'attacker.invalid', 'x-forwarded-proto': 'http',
    'x-real-ip': '1.1.1.1', 'cf-connecting-ip': '1.1.1.1', 'x-pc-review': 'yes',
    'x-tuat-mirror': 'yes', 'x-vercel-id': 'forged', 'proxy-authorization': 'secret', 'next-action': 'action-id',
  } });
  await worker.fetch(incoming, environment(async outgoing => {
    for (const name of ['host', 'forwarded', 'connection', 'x-hop', 'x-forwarded-host', 'x-forwarded-proto',
      'x-real-ip', 'cf-connecting-ip', 'x-pc-review', 'x-tuat-mirror', 'x-vercel-id', 'proxy-authorization']) {
      assert.equal(outgoing.headers.get(name), null, name);
    }
    assert.equal(new URL(outgoing.url).hostname, 'pc-entry.review-account.workers.dev');
    assert.equal(outgoing.headers.get('next-action'), 'action-id');
    return new Response('ok');
  }));
});

test('redirect and multiple Set-Cookie values pass through without rewriting or following', async () => {
  let calls = 0;
  const headers = new Headers({ location: 'https://auth.example.test/oauth?next=%2F' });
  headers.append('set-cookie', 'session=synthetic; Path=/; Secure; HttpOnly');
  headers.append('set-cookie', 'refresh=synthetic; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/; Secure');
  const upstreamResponse = new Response(null, { status: 302, headers });
  const response = await worker.fetch(request('/auth/callback?code=synthetic'), environment(async (_outgoing, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return upstreamResponse;
  }));
  assert.equal(calls, 1);
  assert.equal(response, upstreamResponse);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), headers.get('location'));
  assert.deepEqual(response.headers.getSetCookie(), headers.getSetCookie());
  assert.equal(response.headers.getSetCookie().length, 2);
});

test('RSC response starts before completion and its stream is passed through', async () => {
  let source;
  const stream = new ReadableStream({ start(controller) { source = controller; } });
  const upstreamResponse = new Response(stream, { headers: { 'content-type': 'text/x-component', vary: 'RSC, Next-Router-State-Tree' } });
  const response = await worker.fetch(request('/record?_rsc=synthetic', { headers: { RSC: '1' } }), environment(async outgoing => {
    assert.equal(outgoing.headers.get('rsc'), '1');
    return upstreamResponse;
  }));
  assert.equal(response, upstreamResponse);
  assert.equal(response.body, upstreamResponse.body);
  assert.equal(response.headers.get('vary'), 'RSC, Next-Router-State-Tree');
  const reader = response.body.getReader();
  source.enqueue(encoder.encode('first'));
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
  source.enqueue(encoder.encode('second'));
  source.close();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'second');
  assert.equal((await reader.read()).done, true);
});

test('request body is streamed rather than read before dispatch', async () => {
  let source;
  const body = new ReadableStream({ start(controller) { source = controller; } });
  const incoming = request('/api/upload', { method: 'POST', headers: { origin }, body, duplex: 'half' });
  let calls = 0;
  const response = await worker.fetch(incoming, environment(async outgoing => {
    calls++;
    assert.equal(outgoing.bodyUsed, false);
    source.enqueue(encoder.encode('synthetic image'));
    source.close();
    assert.equal(await outgoing.text(), 'synthetic image');
    return new Response(null, { status: 204 });
  }));
  assert.equal(calls, 1);
  assert.equal(response.status, 204);
});

test('unavailable PC or possibly completed write gets one dispatch and a sanitized no-store 503', async () => {
  for (const method of ['GET', 'POST']) {
    let calls = 0;
    const incoming = request('/api/write', { method, headers: { origin }, ...(method === 'POST' ? { body: 'save' } : {}) });
    const response = await worker.fetch(incoming, environment(async outgoing => {
      calls++;
      if (method === 'POST') await outgoing.text();
      throw Error('synthetic token and internal address must not escape');
    }));
    assert.equal(calls, 1);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { error: 'Service unavailable' });
  }
});

test('upstream HTTP failure remains unchanged and is never retried', async () => {
  let calls = 0;
  const upstreamResponse = new Response('app validation failed', { status: 422 });
  const response = await worker.fetch(request(), environment(async () => { calls++; return upstreamResponse; }));
  assert.equal(response, upstreamResponse);
  assert.equal(calls, 1);
});

test('failure after streaming starts propagates without a second dispatch', async () => {
  let source;
  let calls = 0;
  const upstreamResponse = new Response(new ReadableStream({ start(controller) { source = controller; } }));
  const response = await worker.fetch(request(), environment(async () => { calls++; return upstreamResponse; }));
  const reader = response.body.getReader();
  source.enqueue(encoder.encode('partial'));
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'partial');
  source.error(Error('synthetic interruption'));
  await assert.rejects(reader.read(), /synthetic interruption/);
  assert.equal(calls, 1);
});

test('canonical URL aliases and missing/foreign modifying Origin fail before dispatch', async () => {
  let calls = 0;
  const env = environment(async () => { calls++; return new Response('must not dispatch'); });
  const rejected = [
    new Request('https://preview.review-account.workers.dev/'),
    new Request('http://pc-entry.review-account.workers.dev/'),
    request('/api/write', { method: 'POST', body: 'save' }),
    request('/api/write', { method: 'POST', body: 'save', headers: { origin: 'https://foreign.example.test' } }),
  ];
  for (const incoming of rejected) assert.equal((await worker.fetch(incoming, env)).status, 403);
  assert.equal(calls, 0);
});

test('invalid/unfilled canonical origin or missing binding fails closed without leaking configuration', async () => {
  let calls = 0;
  const dispatch = async () => { calls++; return new Response('must not dispatch'); };
  for (const value of [undefined, 'REPLACE_WITH_ORIGIN', `${origin}/`, `${origin}?token=synthetic`, `${origin}#fragment`,
    'http://pc-entry.review-account.workers.dev', 'https://name:synthetic@pc-entry.review-account.workers.dev']) {
    const response = await worker.fetch(request(), { APP_PUBLIC_ORIGIN: value, PC_APP: { fetch: dispatch } });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Service unavailable' });
  }
  assert.equal((await worker.fetch(request(), { APP_PUBLIC_ORIGIN: origin })).status, 500);
  assert.equal(calls, 0);
});

test('client cancellation signal is preserved on the one upstream request', async () => {
  const controller = new AbortController();
  const incoming = request('/', { signal: controller.signal });
  await worker.fetch(incoming, environment(async outgoing => {
    assert.equal(outgoing.signal.aborted, false);
    controller.abort();
    assert.equal(outgoing.signal.aborted, true);
    return new Response('synthetic');
  }));
});
