// Reuse the one pinned PC app. Cloud Auth and private R2 remain separate services.
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { backupStatusReady, utcTime } from '../pc-backup/status.mjs';

export function loopbackRoot(value) {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value)) throw Error('Explicit loopback root URL required');
  const url = new URL(value);
  if (url.origin !== value || Number(url.port) < 1024 || Number(url.port) > 65535) throw Error('Explicit loopback root URL required');
  return value;
}

export function validateSharedPc(config, env) {
  if (!isAbsolute(config.hostStateDirectory ?? '') || !isAbsolute(config.backupStatusPath ?? '')
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(config.expectedBackupInstanceId ?? '')
    || !/^\d{10,20}$/.test(config.expectedBackupDatabaseSystemIdentifier ?? '')) throw Error('Pinned shared host and backup required');
  const app = loopbackRoot(config.appOrigin);
  const local=env.PC_LOCAL_RUNTIME==='true';
  if(local!==(env.NEXT_PUBLIC_PC_LOCAL_RUNTIME==='true'))throw Error('Local runtime flags must agree');
  if (Number(new URL(app).port) !== config.port || env.PC_APP_RUNTIME !== 'true' || env.NEXT_PUBLIC_PC_APP_RUNTIME !== 'true' ||
      env.PC_BACKEND_ENABLED !== 'true' || env.NEXT_PUBLIC_PC_BACKEND !== 'true' ||
      (!local && env.PC_BACKEND_INTERNAL_URL !== 'http://127.0.0.1:8000') || (local && env.PC_BACKEND_INTERNAL_URL) || app === env.PC_BACKEND_INTERNAL_URL) throw Error('Explicit shared PC app configuration required');
  let origin, auth;
  try { origin = new URL(env.APP_PUBLIC_ORIGIN); if(!local)auth = new URL(env.NEXT_PUBLIC_CLOUD_AUTH_URL); } catch { throw Error('Canonical HTTPS app and explicit Auth required'); }
  if (origin.protocol !== 'https:' || origin.origin !== env.APP_PUBLIC_ORIGIN || origin.username || origin.password ||
      env.NEXT_PUBLIC_SUPABASE_URL !== `${origin.origin}/api/pc-supabase` ||
      (!local && (auth.protocol !== 'https:' || auth.origin !== env.NEXT_PUBLIC_CLOUD_AUTH_URL || !/^[a-z0-9]+\.supabase\.co$/.test(auth.hostname)))) throw Error('Canonical HTTPS app and explicit Auth required');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(config.releaseId ?? '') || config.releaseId === 'dev' ||
      config.releaseId.startsWith('dpl_') || env.PC_APP_RELEASE_ID !== config.releaseId) throw Error('Shared app release mismatch');
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', ...(!local?['NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY']:[]), 'CRON_SECRET', 'SHEET_SYNC_SECRET', 'SHEET_SYNC_GAS_URL']) {
    if (!env[name] || /[\r\n]/.test(env[name])) throw Error(`Missing or invalid ${name}`);
  }
  if (env.SHEET_SYNC_ENABLED !== 'true') throw Error('Preserve explicit sheet sync configuration');
  if(local) {
    const authUrl=loopbackRoot(env.PC_LOCAL_AUTH_URL),restUrl=loopbackRoot(env.PC_LOCAL_REST_URL);
    if(authUrl===restUrl||[authUrl,restUrl].includes(app)||env.IMAGE_STORAGE_DRIVER!=='local'||env.R2_READ_ENABLED!=='false'||env.R2_WRITE_ENABLED!=='false'
      ||!isAbsolute(env.LOCAL_IMAGE_STORAGE_ROOT??'')||!env.LOCAL_IMAGE_SIGNING_KEY||Buffer.byteLength(env.LOCAL_IMAGE_SIGNING_KEY)<32)throw Error('Separate local Auth/REST and private images required');
    for(const name of ['NEXT_PUBLIC_CLOUD_AUTH_URL','NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY','NEXT_PUBLIC_CLOUD_AUTH_MODE','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME'])if(env[name])throw Error('Local Jobs may not mix cloud Auth/image settings');
  } else {
    for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) if (!env[name]) throw Error(`Missing ${name}`);
    if (!/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID) || env.R2_READ_ENABLED !== 'true' || env.R2_WRITE_ENABLED !== 'true' ||env.IMAGE_STORAGE_DRIVER === 'local' || env.IMAGE_STORAGE_READ_ONLY === 'true')throw Error('Preserve writable private R2 image storage');
  }
  if(env.LOCAL_WEB_PUSH_ENABLED==='true'&&(!local||['NEXT_PUBLIC_VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'].some(name=>!env[name])))throw Error('Local Push requires its explicit private configuration');
  if (env.IMAGE_STORAGE_READ_ONLY==='true'||env.PC_TRIAL_VERCEL === 'true' ||
      env.NEXT_PUBLIC_PC_TRIAL === 'true' || env.PC_APP_SYNTHETIC_REVIEW === 'true' || env.NEXT_PUBLIC_CLOUD_AUTH_MODE === 'test' ||
      env.VERCEL || env.VERCEL_ENV || env.NEXT_PUBLIC_PC_REST_RELAY_ORIGIN) throw Error('Independent PC app required');
}

export function backendReady(config, { read = readFileSync, now = Date.now(), imageRoot } = {}) {
  try {
    const host = JSON.parse(read(resolve(config.hostStateDirectory, 'runtime-status.json'), 'utf8'));
    const started = utcTime(host.startedAt), checked = utcTime(host.checkedAt);
    if (host.version !== 1 || host.running !== true || host.releaseCommit !== config.releaseCommit || host.releaseId !== config.releaseId
      || !Number.isFinite(started) || !Number.isFinite(checked) || started > checked || checked > now || now - checked >= 120_000
      || host.backup?.identity?.instanceId !== config.expectedBackupInstanceId
      || host.backup?.identity?.startedAt !== host.startedAt
      || host.backup?.identity?.databaseSystemIdentifier !== config.expectedBackupDatabaseSystemIdentifier
      || host.backup?.statusPath !== config.backupStatusPath) return false;
    const status = JSON.parse(read(config.backupStatusPath, 'utf8'));
    if(imageRoot&&status.backup?.localSnapshot?.imageRoot!==imageRoot)return false;
    return backupStatusReady(status, host.backup.identity, now);
  } catch { return false; }
}

export async function sharedPcReady(config, env, { fetchRequest = fetch, read = readFileSync, clock = Date.now } = {}) {
  try {
    validateSharedPc(config, env);
    const imageRoot=env.PC_LOCAL_RUNTIME==='true'?env.LOCAL_IMAGE_STORAGE_ROOT:undefined;
    if (!backendReady(config, { read, now: clock(), imageRoot })) return false;
    const options = () => ({ signal: AbortSignal.timeout(3000), redirect: 'error', cache: 'no-store' });
    // OpenAPI probes REST/schema readiness without reading a member table. anon cannot SELECT profiles.
    const [app, rest] = await Promise.all([
      fetchRequest(`${config.appOrigin}/api/version`, options()),
      fetchRequest(env.PC_LOCAL_RUNTIME==='true'?`${env.PC_LOCAL_REST_URL}/`:`${env.PC_BACKEND_INTERNAL_URL}/rest/v1/`, { ...options(),
        headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` } }),
    ]);
    if (!app.ok || !rest.ok) return false;
    const [version, schema] = await Promise.all([app.json(), rest.json()]);
    return backendReady(config, { read, now: clock(), imageRoot }) && version?.version === config.releaseCommit && version?.releaseId === config.releaseId &&
      !!schema && typeof schema === 'object' && (schema.swagger === '2.0' || typeof schema.openapi === 'string');
  } catch { return false; }
}
