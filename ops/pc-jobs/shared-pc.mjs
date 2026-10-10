// Reuse the one pinned PC app. Cloud Auth and private R2 remain separate services.
import { readFileSync } from 'node:fs';

export function loopbackRoot(value) {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value)) throw Error('Explicit loopback root URL required');
  const url = new URL(value);
  if (url.origin !== value || Number(url.port) < 1024 || Number(url.port) > 65535) throw Error('Explicit loopback root URL required');
  return value;
}

export function validateSharedPc(config, env) {
  const app = loopbackRoot(config.appOrigin);
  if (Number(new URL(app).port) !== config.port || env.PC_APP_RUNTIME !== 'true' || env.NEXT_PUBLIC_PC_APP_RUNTIME !== 'true' ||
      env.PC_BACKEND_ENABLED !== 'true' || env.NEXT_PUBLIC_PC_BACKEND !== 'true' ||
      env.PC_BACKEND_INTERNAL_URL !== 'http://127.0.0.1:8000' || app === env.PC_BACKEND_INTERNAL_URL) throw Error('Explicit shared PC app configuration required');
  let origin, auth;
  try { origin = new URL(env.APP_PUBLIC_ORIGIN); auth = new URL(env.NEXT_PUBLIC_CLOUD_AUTH_URL); } catch { throw Error('Canonical HTTPS app and cloud Auth required'); }
  if (origin.protocol !== 'https:' || origin.origin !== env.APP_PUBLIC_ORIGIN || origin.username || origin.password ||
      env.NEXT_PUBLIC_SUPABASE_URL !== `${origin.origin}/api/pc-supabase` ||
      auth.protocol !== 'https:' || auth.origin !== env.NEXT_PUBLIC_CLOUD_AUTH_URL || !/^[a-z0-9]+\.supabase\.co$/.test(auth.hostname)) throw Error('Canonical HTTPS app and cloud Auth required');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(config.releaseId ?? '') || config.releaseId === 'dev' ||
      config.releaseId.startsWith('dpl_') || env.PC_APP_RELEASE_ID !== config.releaseId) throw Error('Shared app release mismatch');
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY', 'CRON_SECRET', 'SHEET_SYNC_SECRET', 'SHEET_SYNC_GAS_URL']) {
    if (!env[name] || /[\r\n]/.test(env[name])) throw Error(`Missing or invalid ${name}`);
  }
  if (env.SHEET_SYNC_ENABLED !== 'true') throw Error('Preserve explicit sheet sync configuration');
  for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) if (!env[name]) throw Error(`Missing ${name}`);
  if (!/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID) || env.R2_READ_ENABLED !== 'true' || env.R2_WRITE_ENABLED !== 'true' ||
      env.IMAGE_STORAGE_DRIVER === 'local' || env.IMAGE_STORAGE_READ_ONLY === 'true') throw Error('Preserve writable private R2 image storage');
  if (env.PC_LOCAL_RUNTIME === 'true' || env.NEXT_PUBLIC_PC_LOCAL_RUNTIME === 'true' || env.PC_TRIAL_VERCEL === 'true' ||
      env.NEXT_PUBLIC_PC_TRIAL === 'true' || env.PC_APP_SYNTHETIC_REVIEW === 'true' || env.NEXT_PUBLIC_CLOUD_AUTH_MODE === 'test' ||
      env.VERCEL || env.VERCEL_ENV || env.NEXT_PUBLIC_PC_REST_RELAY_ORIGIN) throw Error('Independent PC app required');
}

export function backendReady(config, { read = readFileSync, now = Date.now() } = {}) {
  try {
    const backend = JSON.parse(read(`${config.backendDirectory}/config.json`, 'utf8'));
    const heartbeat = JSON.parse(read(`${config.backendDirectory}/runtime-status.json`, 'utf8'));
    const backup = JSON.parse(read(`${config.backendDirectory}/backup-status.json`, 'utf8'));
    const heartbeatAge = now - Date.parse(heartbeat.checkedAt), backupAge = now - Date.parse(backup.completedAt);
    const returnAt = backend.returnAt ? Date.parse(backend.returnAt) : undefined;
    return backend.maintenance === false && (returnAt === undefined || (Number.isFinite(returnAt) && now < returnAt)) &&
      heartbeat.healthy === true && heartbeat.maintenance === false && heartbeatAge >= 0 && heartbeatAge < 120000 &&
      backupAge >= 0 && backupAge < 35 * 60000;
  } catch { return false; }
}

export async function sharedPcReady(config, env, { fetchRequest = fetch, read = readFileSync, now = Date.now() } = {}) {
  try {
    validateSharedPc(config, env);
    if (!backendReady(config, { read, now })) return false;
    const options = () => ({ signal: AbortSignal.timeout(3000), redirect: 'error', cache: 'no-store' });
    // OpenAPI probes REST/schema readiness without reading a member table. anon cannot SELECT profiles.
    const [app, rest] = await Promise.all([
      fetchRequest(`${config.appOrigin}/api/version`, options()),
      fetchRequest(`${env.PC_BACKEND_INTERNAL_URL}/rest/v1/`, { ...options(),
        headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` } }),
    ]);
    if (!app.ok || !rest.ok) return false;
    const [version, schema] = await Promise.all([app.json(), rest.json()]);
    return version?.version === config.releaseCommit && version?.releaseId === config.releaseId &&
      !!schema && typeof schema === 'object' && (schema.swagger === '2.0' || typeof schema.openapi === 'string');
  } catch { return false; }
}
