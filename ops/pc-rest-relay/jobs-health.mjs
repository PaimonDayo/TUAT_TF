// Private monitor endpoint; exposes only a boolean, never job/member details.
export async function jobsHealth(request, env) {
  const reply = status => Response.json({ ok: status === 200 }, { status, headers: { 'cache-control': 'no-store' } });
  if (!env.MONITOR_SECRET || !env.PC_JOBS_HEALTH_KEY) return reply(404);
  const encoder = new TextEncoder();
  const digest = text => crypto.subtle.digest('SHA-256', encoder.encode(text));
  const [expected, actual] = await Promise.all([digest(`Bearer ${env.MONITOR_SECRET}`), digest(request.headers.get('authorization') ?? '')]);
  let difference = 0;
  new Uint8Array(expected).forEach((value, i) => { difference |= value ^ new Uint8Array(actual)[i]; });
  if (difference || request.method !== 'GET') return reply(401);
  try {
    const object = await env.ENDPOINTS.get(`ops/pc-backend/${env.PC_BACKEND_INSTANCE_ID}/jobs-health.json`);
    if (!object || object.size > 2048) return reply(503);
    const value = await object.json(), now = Date.now();
    if (value.version !== 1 || typeof value.healthy !== 'boolean' || !Number.isFinite(value.checkedAt) || value.checkedAt > now + 30000 ||
        value.expiresAt !== value.checkedAt + 180000 || value.expiresAt <= now || !/^[a-f0-9]{64}$/.test(value.signature)) return reply(503);
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.PC_JOBS_HEALTH_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, Uint8Array.from(value.signature.match(/../g), x => parseInt(x, 16)), encoder.encode(JSON.stringify([1, value.checkedAt, value.healthy, value.expiresAt])));
    return reply(valid && value.healthy ? 200 : 503);
  } catch { return reply(503); }
}
