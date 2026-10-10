// Mock integration only: this is not Supabase, PostgreSQL, RLS, or provider verification.
// No external fetch, production configuration loading, or container control is permitted here.
import http from 'node:http';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstatSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const PC_ORIGIN = 'http://127.0.0.1:18180';
const AUTH_ORIGIN = 'http://127.0.0.1:18181';
const OWNER = 'pc-precutover-synthetic-20261011';
const MAX_BODY = 64 * 1024;
const EXTERNAL_CREDENTIAL = /^(?:NEXT_PUBLIC_(?:SUPABASE|CLOUD_AUTH)|SUPABASE_|R2_|GOOGLE_(?:DRIVE|CLIENT)|SHEET_SYNC_(?:GAS|SECRET)|PC_BACKEND_(?:BRIDGE_KEY|INSTANCE_ID))/;

export function rejectExternalCredentials(env = process.env) {
  // Examine names only; never inspect inherited credential values.
  if (Object.keys(env).some(key => EXTERNAL_CREDENTIAL.test(key))) throw Error('Inherited provider credentials are forbidden in the synthetic fixture');
}

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function jwt(secret, claims) {
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${content}.${createHmac('sha256', secret).update(content).digest('base64url')}`;
}
export function verifyToken(token, secret, issuer, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (header.alg !== 'HS256' || claims.iss !== issuer || !Number.isInteger(claims.exp) || claims.exp <= now || (claims.nbf !== undefined && claims.nbf > now)) return null;
    const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    return equal(parts[2], expected) ? claims : null;
  } catch { return null; }
}

export function generateFixture() {
  const now = Math.floor(Date.now() / 1000);
  const pcSecret = randomBytes(32).toString('hex'), authSecret = randomBytes(32).toString('hex');
  const identity = (name, email) => {
    const id = randomUUID(), timestamp = new Date().toISOString();
    return { id, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: timestamp,
      app_metadata: { provider: 'google', providers: ['google'], synthetic_review: true }, user_metadata: { full_name: name },
      identities: [{ id: randomUUID(), user_id: id, provider: 'google', identity_data: { sub: id, email, email_verified: true }, created_at: timestamp, updated_at: timestamp }],
      created_at: timestamp, updated_at: timestamp };
  };
  const users = {
    member: identity('Synthetic member', 'synthetic-member@review.test'),
    external: identity('Synthetic external member', 'synthetic-external@example.test'),
    revoked: identity('Synthetic revoked member', 'synthetic-revoked@example.test'),
  };
  const apiKey = (secret, issuer, role) => jwt(secret, { iss: issuer, role, iat: now, exp: now + 7200 });
  const keys = { pcAnon: apiKey(pcSecret, PC_ORIGIN, 'anon'), pcServiceRole: apiKey(pcSecret, PC_ORIGIN, 'service_role'),
    cloudAnon: apiKey(authSecret, AUTH_ORIGIN, 'anon'), cloudServiceRole: apiKey(authSecret, AUTH_ORIGIN, 'service_role') };
  const sessions = Object.fromEntries(Object.entries(users).map(([name, user]) => [name, {
    access_token: jwt(authSecret, { iss: AUTH_ORIGIN, sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 }),
    token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: randomBytes(32).toString('hex'), user,
  }]));
  const expired = { ...sessions.member, access_token: jwt(authSecret, { iss: AUTH_ORIGIN, sub: users.member.id, email: users.member.email,
    role: 'authenticated', aud: 'authenticated', iat: now - 3600, exp: now - 1 }), expires_at: now - 1 };
  const invalid = { ...sessions.member, access_token: `${sessions.member.access_token.slice(0, -1)}${sessions.member.access_token.endsWith('a') ? 'b' : 'a'}` };
  const cookie = session => `sb-tuat-auth=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  const cookies = { member: cookie(sessions.member), external: cookie(sessions.external), revoked: cookie(sessions.revoked),
    expired: cookie(expired), invalid: cookie(invalid), spoofedUser: cookie({ ...sessions.member, user: users.external }) };
  const pkce = { code: randomBytes(24).toString('hex'), verifier: randomBytes(32).toString('hex') };
  const manifest = { version: 1, kind: 'tuat-pc-precutover-mock', owner: OWNER, instanceId: randomUUID(), mockOnly: true,
    pcOrigin: PC_ORIGIN, authOrigin: AUTH_ORIGIN, keys, users, sessions, cookies, pkce };
  return { manifest, pcSecret, authSecret };
}

function profile(user) {
  return { id: user.id, email: user.email, display_name: user.user_metadata.full_name, avatar_url: null, blocks: ['short'], events: [], grade: 'B1',
    status: 'active', approved: true, role: 'member', goal: null, notify_mention: true, notify_comment: true, notify_notice: true,
    menu_view_all_blocks: false, schedule_view_all_blocks: false, attendance_view_all_blocks: false, attendance_default_block: 'short',
    timeline_default_block: 'short', sheet_name: null, record_source: 'app', record_fields: [], record_fields_version: 1, created_at: user.created_at };
}
function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' });
  res.end(status === 204 ? undefined : JSON.stringify(value));
}
function rows(req, res, value) {
  if (req.headers.accept?.includes('application/vnd.pgrst.object+json')) {
    if (value.length !== 1) return json(res, 406, { code: 'PGRST116', details: `The result contains ${value.length} rows`, message: 'Synthetic singular result unavailable' });
    return json(res, 200, value[0]);
  }
  res.setHeader('content-range', `0-${Math.max(0, value.length - 1)}/${value.length}`);
  return json(res, 200, value);
}
function readJson(req) {
  return new Promise((accept, reject) => {
    const chunks = []; let bytes = 0, ended = false;
    const finish = (error, value) => {
      if (ended) return; ended = true; clearTimeout(timer);
      req.removeListener('data', data); req.removeListener('end', end);
      if (error) reject(error); else accept(value);
    };
    const data = chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY) { const error = Error('Synthetic request too large'); error.status = 413; finish(error); req.resume(); }
      else chunks.push(chunk);
    };
    const end = () => {
      try { finish(null, bytes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { const error = Error('Synthetic request invalid'); error.status = 400; finish(error); }
    };
    const timer = setTimeout(() => { const error = Error('Synthetic request timed out'); error.status = 408; finish(error); req.resume(); }, 5000);
    req.on('data', data); req.once('end', end); req.once('error', () => finish(Error('Synthetic request interrupted')));
  });
}

export function createSyntheticPair(fixture = generateFixture()) {
  const { manifest, pcSecret, authSecret } = fixture;
  const counters = { authUser: 0, authToken: 0, authAdmin: 0, pcRest: 0, cloudRestRejected: 0, rejected: 0, pcUnavailable: 0 };
  const profiles = new Map(Object.values(manifest.users).map(user => [user.id, profile(user)]));
  const roleId = randomUUID(); let pcAvailable = true, codeUsed = false;
  const findUser = id => Object.values(manifest.users).find(user => user.id === id);
  const claimsOf = (req, kind) => {
    const token = req.headers.authorization?.replace(/^Bearer /i, '');
    return verifyToken(token, authSecret, AUTH_ORIGIN) ?? (kind === 'pc' ? verifyToken(token, pcSecret, PC_ORIGIN) : null);
  };
  const handler = kind => async (req, res) => {
    try {
      const origin = kind === 'pc' ? PC_ORIGIN : AUTH_ORIGIN;
      if (req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'Synthetic loopback host required' });
      const url = new URL(req.url, origin), path = url.pathname;
      if (path === '/health' && req.method === 'GET') return json(res, 200, { mockOnly: true, owner: OWNER, counters: { ...counters } });
      const validKeys = kind === 'pc' ? [manifest.keys.pcAnon, manifest.keys.pcServiceRole] : [manifest.keys.cloudAnon, manifest.keys.cloudServiceRole];
      if (!validKeys.some(key => equal(req.headers.apikey, key))) { counters.rejected++; return json(res, 401, { error: 'Synthetic API key required' }); }
      const claims = claimsOf(req, kind);
      if (path.startsWith('/rest/v1') && kind === 'auth') {
        counters.cloudRestRejected++; return json(res, 403, { error: 'Cloud business data is forbidden in this fixture' });
      }
      if (path === '/auth/v1/.well-known/jwks.json' && req.method === 'GET') return json(res, 200, { keys: [] });
      if (path === '/auth/v1/user' && req.method === 'GET') {
        counters.authUser++;
        const user = claims?.role === 'authenticated' && claims.aud === 'authenticated' ? findUser(claims.sub) : null;
        return user ? json(res, 200, user) : json(res, 401, { code: 'bad_jwt', message: 'Synthetic token rejected' });
      }
      if (path === '/auth/v1/token' && req.method === 'POST' && kind === 'auth') {
        counters.authToken++; const body = await readJson(req);
        const grant = url.searchParams.get('grant_type');
        let session;
        if (grant === 'refresh_token') session = Object.values(manifest.sessions).find(value => equal(body.refresh_token, value.refresh_token));
        if (grant === 'pkce' && !codeUsed && equal(body.auth_code, manifest.pkce.code) && equal(body.code_verifier, manifest.pkce.verifier)) {
          codeUsed = true; session = manifest.sessions.member;
        }
        return session ? json(res, 200, session) : json(res, 400, { error: 'invalid_grant', error_description: 'Synthetic grant rejected' });
      }
      if (path === '/auth/v1/logout' && req.method === 'POST' && claims?.role === 'authenticated') return json(res, 204);
      if (/^\/auth\/v1\/admin\/users(?:\/[^/]+)?$/.test(path)) {
        counters.authAdmin++;
        const service = kind === 'pc' ? manifest.keys.pcServiceRole : manifest.keys.cloudServiceRole;
        if (!equal(req.headers.authorization, `Bearer ${service}`)) return json(res, 403, { error: 'Synthetic admin token required' });
        const id = path.split('/')[5];
        if (req.method === 'GET' && !id) return json(res, 200, { users: Object.values(manifest.users), aud: 'authenticated', total: 3, next_page: null });
        if (req.method === 'GET' && id) return findUser(id) ? json(res, 200, { user: findUser(id) }) : json(res, 404, { error: 'Synthetic user absent' });
        return json(res, 405, { error: 'Synthetic identities are fixed' });
      }
      if (path.startsWith('/rest/v1/') && kind === 'pc') {
        counters.pcRest++;
        if (!pcAvailable) { counters.pcUnavailable++; return json(res, 503, { code: '08006', message: 'Synthetic PC unavailable' }); }
        if (!claims || (claims.role !== 'service_role' && (claims.role !== 'authenticated' || claims.aud !== 'authenticated' || !findUser(claims.sub)))) {
          counters.rejected++; return json(res, 401, { code: '42501', message: 'Synthetic verified identity required' });
        }
        const revoked = claims.sub === manifest.users.revoked.id;
        if (path === '/rest/v1/rpc/login_access_allowed' && req.method === 'POST') return json(res, 200, !revoked);
        if (path === '/rest/v1/rpc/is_member' && req.method === 'POST') return json(res, 200, !revoked && profiles.get(claims.sub)?.approved === true);
        if (revoked) return json(res, 403, { code: 'PT403', message: 'Synthetic access revoked' });
        const table = path.slice('/rest/v1/'.length);
        if (table === 'profiles') {
          const id = url.searchParams.get('id')?.replace(/^eq\./, '') ?? claims.sub;
          const allowed = claims.role === 'service_role' || id === claims.sub;
          if (!allowed) return rows(req, res, []);
          if (req.method === 'PATCH') {
            const body = await readJson(req);
            if (!profiles.has(id) || Object.keys(body).some(key => !['display_name', 'avatar_url', 'goal'].includes(key))) return json(res, 403, { code: '42501', message: 'Synthetic update rejected' });
            const match = url.searchParams.get('avatar_url');
            if (match && (match === 'is.null' ? profiles.get(id).avatar_url !== null : profiles.get(id).avatar_url !== match.replace(/^eq\./, ''))) return rows(req, res, []);
            Object.assign(profiles.get(id), body); return rows(req, res, [profiles.get(id)]);
          }
          if (req.method === 'GET' || req.method === 'HEAD') return rows(req, res, profiles.has(id) ? [profiles.get(id)] : []);
        }
        if (table === 'roles' && req.method === 'GET') return rows(req, res, [{ id: roleId, name: 'Synthetic member', scope: 'global', is_admin: false, is_staff: false, can_manage_system: false, can_manage_members: false }]);
        if (table === 'profile_roles' && req.method === 'GET') return rows(req, res, [{ profile_id: claims.sub, role_id: roleId }]);
        return json(res, 404, { code: 'PGRST205', message: 'Route outside the bounded synthetic fixture' });
      }
      return json(res, 404, { error: 'Route outside the bounded synthetic fixture' });
    } catch (error) {
      return json(res, [400, 408, 413].includes(error.status) ? error.status : 503, { error: 'Synthetic operation unavailable' });
    }
  };
  const server = kind => {
    const value = http.createServer(handler(kind));
    value.requestTimeout = 5000; value.headersTimeout = 5000; value.keepAliveTimeout = 1000; value.maxHeadersCount = 64; value.maxConnections = 32;
    return value;
  };
  const pc = server('pc'), auth = server('auth');
  const close = async () => {
    for (const listener of [pc, auth]) listener.closeAllConnections();
    await Promise.all([pc, auth].filter(listener => listener.listening).map(listener => new Promise(resolveClose => listener.close(resolveClose))));
  };
  return { pc, auth, manifest, close, setPcAvailable: value => { pcAvailable = value === true; }, status: () => ({ mockOnly: true, counters: { ...counters } }),
    async listen() {
      try {
        for (const [listener, port] of [[pc, 18180], [auth, 18181]]) await new Promise((accept, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', accept); });
      } catch (error) { await close(); throw error; }
    } };
}

export function verifyPrivateState(directory) {
  if (!isAbsolute(directory) || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink() || realpathSync(directory).toLowerCase() !== resolve(directory).toLowerCase()) throw Error('An existing private absolute state directory is required');
  if (!basename(directory).includes(OWNER)) throw Error('An owner-named synthetic state directory is required');
  if (process.platform === 'win32') {
    const script = '$ErrorActionPreference="Stop"; $a=Get-Acl -LiteralPath $env:TUAT_SYNTHETIC_STATE; $s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; [pscustomobject]@{Protected=$a.AreAccessRulesProtected; Rules=$a.Access.Count; Unexpected=@($a.Access | Where-Object {$_.AccessControlType -ne "Allow" -or $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin @($s,"S-1-5-18")}).Count} | ConvertTo-Json -Compress';
    const modules = resolve(process.env.ProgramFiles, 'PowerShell/7/Modules');
    const acl = JSON.parse(execFileSync(resolve(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env: { ...process.env, PSModulePath: modules, TUAT_SYNTHETIC_STATE: directory } }));
    if (!acl.Protected || acl.Rules !== 2 || acl.Unexpected !== 0) throw Error('Synthetic state must be ACL-private before writing keys');
  } else if ((lstatSync(directory).mode & 0o077) !== 0) throw Error('Synthetic state must be private before writing keys');
}

export function writeFixtureState(directory, fixture) {
  verifyPrivateState(directory);
  const manifest = fixture.manifest;
  writeFileSync(resolve(directory, 'fixture.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const env = { PC_BACKEND_INTERNAL_URL: PC_ORIGIN, NEXT_PUBLIC_CLOUD_AUTH_URL: AUTH_ORIGIN, NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY: manifest.keys.cloudAnon,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: manifest.keys.pcAnon, SUPABASE_SERVICE_ROLE_KEY: manifest.keys.pcServiceRole,
    PC_APP_SYNTHETIC_REVIEW: 'true', NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW: 'true', NEXT_PUBLIC_CLOUD_AUTH_MODE: 'test',
    IMAGE_STORAGE_READ_ONLY: 'true', R2_READ_ENABLED: 'false', R2_WRITE_ENABLED: 'false', SHEET_SYNC_ENABLED: 'false' };
  writeFileSync(resolve(directory, 'synthetic.env'), Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
}

async function main(args) {
  rejectExternalCredentials();
  let serve = false, check = false, directory;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--serve') serve = true;
    else if (args[i] === '--check') check = true;
    else if (args[i] === '--state-dir') { directory = args[++i]; if (!directory || directory.startsWith('--')) throw Error('State directory value required'); }
    else throw Error('Unknown synthetic fixture option');
  }
  if (serve && check) throw Error('Choose check or serve');
  if (!serve) {
    if (directory) verifyPrivateState(directory);
    console.log(JSON.stringify({ mockOnly: true, mode: 'check', owner: OWNER, pcOrigin: PC_ORIGIN, authOrigin: AUTH_ORIGIN, startsListeners: false, writesKeys: false }));
    return;
  }
  if (!directory) throw Error('Serve requires an existing ACL-private owner-named --state-dir');
  const fixture = generateFixture(), pair = createSyntheticPair(fixture);
  writeFixtureState(directory, fixture);
  await pair.listen();
  console.log(JSON.stringify({ mockOnly: true, mode: 'serving', owner: OWNER, pcOrigin: PC_ORIGIN, authOrigin: AUTH_ORIGIN }));
  const input = createInterface({ input: process.stdin, terminal: false });
  input.on('line', line => {
    if (line.length > 32) return;
    if (line === 'pc-down') pair.setPcAvailable(false);
    else if (line === 'pc-up') pair.setPcAvailable(true);
    else if (line === 'status') console.log(JSON.stringify(pair.status()));
    else if (line === 'stop') void finish();
  });
  const finish = async () => { input.close(); await pair.close(); };
  process.once('SIGINT', finish); process.once('SIGTERM', finish);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => { console.error('Synthetic fixture refused or failed; no external targets were contacted'); process.exitCode = 1; });
}
