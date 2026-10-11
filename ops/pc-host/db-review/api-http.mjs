// Actual PostgREST HTTP in a freshly owned, unpublished internal Docker network.
// Test signing keys/passwords stay in process/container memory and never print.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, generateKeyPairSync, createHmac, sign } from 'node:crypto';
import { attemptResource, cleanupOwned } from './cleanup-owned.mjs';

const image = 'postgrest/postgrest:v14.12';
const imageId = 'sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c';
const owner = 'codex-auth-db-review';
const [flag, container] = process.argv.slice(2);
if (flag !== '--container' || process.argv.length !== 4 || !/^codex-auth-dbreview-[a-f0-9]{32}$/.test(container ?? '')) throw Error('Explicit fresh owner-named synthetic container required');
const generation = container.slice('codex-auth-dbreview-'.length);
const apiName = `${container}-postgrest`, networkName = `${container}-internal`;
const secrets = [];
const report = { version: 1, image, imageId, realHttp: true, syntheticOnly: true, hostPorts: [], network: 'internal', signingAlgorithms: ['ES256', 'HS256'], ephemeralTestKeys: true, productionAccess: false, providerCalls: 0, cloudGoogleProved: false, checks: [], cleanup: false };
let stage = 'boundary', pgId, apiId, seeded = false;
const attempted = {};
const ids = { a: randomUUID(), b: randomUUID(), manager: randomUUID(), unapproved: randomUUID(), denied: randomUUID(), neutralRole: randomUUID(), managerRole: randomUUID(), privateNote: randomUUID(), publishedNote: randomUUID() };
const emails = Object.fromEntries(['a', 'b', 'manager', 'unapproved', 'denied'].map(key => [key, `api-${key}-${generation}@example.invalid`]));
const extraEmail = `api-added-${generation}@example.invalid`;

function safe(value) {
  let result = String(value);
  for (const secret of secrets) result = result.replaceAll(secret, '[ephemeral-test-value]');
  return result.slice(-2400);
}
function docker(args, input = '') {
  return new Promise((resolve, reject) => {
    // --exec preserves arguments (HTTP header spaces/newlines) without a shell.
    const child = spawn('wsl.exe', ['-d', 'Ubuntu', '--exec', 'docker', ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), 25000);
    child.stdout.on('data', chunk => { out += chunk; if (out.length > 262144) child.kill(); });
    child.stderr.on('data', chunk => { err += chunk; if (err.length > 32768) child.kill(); });
    child.on('error', () => { clearTimeout(timer); reject(Error('Owned API fixture command unavailable')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(args[0] === 'logs' ? out + err : out);
      else reject(Error(safe(err || 'Owned API fixture command failed')));
    });
    child.stdin.end(input);
  });
}
const sql = statement => docker(['exec', '-i', pgId, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'tuat_rls_review'], statement);
const last = output => output.trim().split(/\r?\n/).at(-1);
const service = `SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',false);`;

function ensure(condition, message) { if (!condition) throw Error(message); }
async function check(name, fn) {
  stage = name;
  const evidence = await fn();
  report.checks.push({ name, passed: true, ...evidence });
}
async function request(path, { token, method = 'GET', body, headers = [] } = {}) {
  ensure(path.startsWith('/') && !path.includes('://'), 'Owned API-relative request required');
  const args = ['exec', '-i', pgId, 'curl', '--silent', '--show-error', '--max-time', '10', '--request', method, '--write-out', '\n%{http_code}', '--header', 'Content-Type: application/json'];
  if (token) args.push('--header', `Authorization: Bearer ${token}`);
  for (const header of headers) args.push('--header', header);
  if (body !== undefined) args.push('--data-binary', '@-');
  args.push(`http://${apiName}:3000${path}`);
  const output = await docker(args, body === undefined ? '' : JSON.stringify(body));
  const at = output.lastIndexOf('\n'), status = Number(output.slice(at + 1).trim());
  let data;
  try { data = JSON.parse(output.slice(0, at)); } catch { data = null; }
  return { status, data };
}
function status(response, expected) {
  ensure((Array.isArray(expected) ? expected : [expected]).includes(response.status), `HTTP status ${response.status}; expected ${[].concat(expected).join('/')}; code ${response.data?.code ?? 'none'}`);
}
const evidence = response => ({ status: response.status, ...(response.data?.code ? { code: response.data.code } : {}) });
const representation = ['Prefer: return=representation'];

try {
  // Inspect only structural fields, never container environment/signing keys.
  pgId = (await docker(['inspect', '--format', '{{.Id}}', container])).trim();
  const pgLabels = JSON.parse(await docker(['inspect', '--format', '{{json .Config.Labels}}', pgId]));
  ensure(/^[a-f0-9]{64}$/.test(pgId) && pgLabels['tuat.owner'] === owner && pgLabels['tuat.generation'] === generation, 'Fresh PG ownership mismatch');
  ensure((await docker(['inspect', '--format', '{{.Name}}', pgId])).trim() === `/${container}`, 'Fresh PG name mismatch');
  ensure(['{}', 'null'].includes((await docker(['inspect', '--format', '{{json .HostConfig.PortBindings}}', pgId])).trim()), 'Published PG ports prohibited');
  ensure((await docker(['inspect', '--format', '{{.HostConfig.NetworkMode}}', pgId])).trim() === networkName, 'Fresh PG network mismatch');
  const network = JSON.parse(await docker(['network', 'inspect', networkName]))[0];
  ensure(network.Internal && network.Labels['tuat.owner'] === owner && network.Labels['tuat.generation'] === generation, 'Owned internal network required');
  ensure((await docker(['image', 'inspect', '--format', '{{.Id}}', image])).trim() === imageId, 'Cached PostgREST pin mismatch');
  ensure(!(await docker(['container', 'ls', '-a', '--filter', `name=^/${apiName}$`, '--format', '{{.ID}}'])).trim(), 'Fresh API container already exists');
  ensure(last(await sql(`SELECT (current_database()='tuat_rls_review' AND NOT EXISTS(SELECT 1 FROM auth.users) AND NOT EXISTS(SELECT 1 FROM public.profiles) AND NOT EXISTS(SELECT 1 FROM public.login_email_allowlist) AND current_setting('cron.launch_active_jobs')='off')::text;`)) === 'true', 'Fresh empty current schema required');
  ensure(last(await sql(`SELECT EXISTS(SELECT 1 FROM pg_roles,unnest(rolconfig) setting WHERE rolname='authenticator' AND setting='pgrst.db_pre_request=public.check_login_access');`)) === 't', 'Current migration pre-request guard missing');

  stage = 'fixture';
  const dbPassword = randomBytes(32).toString('hex'); secrets.push(dbPassword);
  await sql(`${service}
    ALTER ROLE authenticator WITH PASSWORD '${dbPassword}';
    INSERT INTO auth.users(id,email) VALUES ${Object.keys(emails).map(key => `('${ids[key]}','${emails[key]}')`).join(',')};
    INSERT INTO public.login_email_allowlist(email,created_by) VALUES ${['a', 'b', 'manager', 'unapproved'].map(key => `('${emails[key]}','${ids.manager}')`).join(',')};
    INSERT INTO public.roles(id,name,can_manage_members) VALUES ('${ids.neutralRole}','Synthetic API neutral',false),('${ids.managerRole}','Synthetic API manager',true);
    INSERT INTO public.profile_roles(profile_id,role_id) VALUES ('${ids.manager}','${ids.neutralRole}'),('${ids.manager}','${ids.managerRole}');
    UPDATE public.profiles SET approved=false WHERE id='${ids.unapproved}';
    INSERT INTO public.notes(id,author_id,scope,title,body,status,edit_policy) VALUES ('${ids.privateNote}','${ids.b}','personal','Synthetic private note','','draft','author'),('${ids.publishedNote}','${ids.b}','personal','Synthetic published note','','published','author');`);
  seeded = true;

  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ecKid = randomUUID(), hsKid = randomUUID(), hmac = randomBytes(48);
  secrets.push(hmac.toString('base64url'));
  const jwks = { keys: [{ ...pair.publicKey.export({ format: 'jwk' }), use: 'sig', alg: 'ES256', kid: ecKid }, { kty: 'oct', k: hmac.toString('base64url'), use: 'sig', alg: 'HS256', kid: hsKid }] };
  const encodedJwks = Buffer.from(JSON.stringify(jwks)).toString('base64'); secrets.push(encodedJwks);
  const now = Math.floor(Date.now() / 1000);
  function jwt(key = 'a', overrides = {}, algorithm = 'ES256', wrongKey = false) {
    const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT', kid: algorithm === 'ES256' ? ecKid : hsKid })).toString('base64url');
    const claims = { sub: ids[key], role: 'authenticated', email: emails[key], aud: 'authenticated', iss: 'http://synthetic-auth.invalid', iat: now, nbf: now - 60, exp: now + 600, ...overrides };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url'), message = `${header}.${payload}`;
    const signature = algorithm === 'ES256' ? sign('sha256', Buffer.from(message), { key: wrongKey ? generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey : pair.privateKey, dsaEncoding: 'ieee-p1363' }) : createHmac('sha256', wrongKey ? randomBytes(48) : hmac).update(message).digest();
    const token = `${message}.${signature.toString('base64url')}`; secrets.push(token); return token;
  }
  const tokenA = jwt(), tokenB = jwt('b'), tokenManager = jwt('manager'), tokenUnapproved = jwt('unapproved'), tokenDenied = jwt('denied'), serviceToken = jwt('a', { role: 'service_role' });

  stage = 'postgrest-start';
  apiId = (await attemptResource(attempted, 'api', () => docker(['create', '--name', apiName, '--label', `tuat.owner=${owner}`, '--label', `tuat.generation=${generation}`, '--network', networkName, '--read-only', '--memory', '128m', '--cpus', '0.5',
    '-e', `PGRST_DB_URI=postgres://authenticator:${dbPassword}@${container}:5432/tuat_rls_review`, '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', 'PGRST_DB_POOL=3', '-e', 'PGRST_DB_CONFIG=true',
    '-e', 'PGRST_JWT_AUD=authenticated', '-e', `PGRST_JWT_SECRET=${encodedJwks}`, '-e', 'PGRST_JWT_SECRET_IS_BASE64=true', '-e', 'PGRST_LOG_LEVEL=crit', '-e', 'PGRST_LOG_QUERY=false', '--entrypoint', 'postgrest', image, '/dev/null']))).trim();
  ensure(/^[a-f0-9]{64}$/.test(apiId), 'Fresh API container ID missing');
  await docker(['start', apiId]);
  let ready = false, readiness = {};
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const probe = await request('/profiles?select=id&limit=0', { token: tokenA }); readiness = { status: probe.status, code: probe.data?.code, message: safe(probe.data?.message ?? '') }; if (probe.status === 200) { ready = true; break; } } catch (error) { readiness = { transport: safe(error.message) }; /* Read-only readiness only. Never retry a write. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  report.readiness = readiness;
  if (!ready) throw Error(`PostgREST failed read-only readiness ${JSON.stringify(readiness)}: ${safe(await docker(['logs', '--tail', '3', apiId]))}`);

  await check('valid ES256 JWT and same Auth/profile UUID', async () => {
    const r = await request(`/profiles?id=eq.${ids.a}&select=id,email,approved`, { token: tokenA }); status(r, 200);
    ensure(r.data.length === 1 && r.data[0].id === ids.a && r.data[0].email === emails.a && r.data[0].approved, 'Verified subject/profile UUID mismatch'); return evidence(r);
  });
  await check('valid HS256 JWT', async () => { const r = await request(`/profiles?id=eq.${ids.a}&select=id`, { token: jwt('a', {}, 'HS256') }); status(r, 200); ensure(r.data.length === 1 && r.data[0].id === ids.a, 'HS256 subject mismatch'); return evidence(r); });
  for (const [name, token] of [
    ['wrong ES256 signature', jwt('a', {}, 'ES256', true)], ['wrong HS256 signature', jwt('a', {}, 'HS256', true)],
    ['expired signed token', jwt('a', { exp: now - 600 })], ['future signed token', jwt('a', { nbf: now + 600 })], ['wrong JWT audience', jwt('a', { aud: 'other-synthetic-audience' })]
  ]) await check(name, async () => { const r = await request('/profiles?select=id&limit=0', { token }); status(r, 401); ensure(/^PGRST3/.test(r.data?.code ?? ''), 'JWT rejection must come from actual verifier'); return evidence(r); });
  await check('modified subject and role invalidate signature', async () => {
    const parts = tokenA.split('.'); parts[1] = Buffer.from(JSON.stringify({ sub: ids.b, role: 'service_role', email: emails.b, aud: 'authenticated', exp: now + 600 })).toString('base64url'); const tampered = parts.join('.'); secrets.push(tampered);
    const r = await request('/confirmed_image_retirements?select=bucket&limit=0', { token: tampered }); status(r, 401); ensure(/^PGRST3/.test(r.data?.code ?? ''), 'Modified claims bypassed signature'); return evidence(r);
  });
  await check('anonymous profile read denied', async () => { const r = await request('/profiles?select=id'); status(r, [401, 403]); ensure(r.data?.code === '42501', 'Anonymous table permission unexpectedly changed'); return evidence(r); });
  await check('unlisted external signed token denied', async () => { const r = await request('/profiles?select=id', { token: tokenDenied }); status(r, 403); ensure(r.data?.code === 'PT403', 'Current pre-request allowlist not enforced'); return evidence(r); });
  await check('own ordinary profile edit commits exactly one row', async () => {
    const r = await request(`/profiles?id=eq.${ids.a}&select=id,display_name`, { token: tokenA, method: 'PATCH', body: { display_name: 'Synthetic API saved profile' }, headers: [...representation, `X-User-Id: ${ids.b}`] }); status(r, 200);
    ensure(r.data.length === 1 && r.data[0].id === ids.a && r.data[0].display_name === 'Synthetic API saved profile', 'Own profile save affected wrong UUID'); return { ...evidence(r), rows: 1 };
  });
  await check('signed subject overrides untrusted user metadata', async () => {
    const token = jwt('b', { user_metadata: { id: ids.a, role: 'admin' } });
    const r = await request(`/profiles?id=eq.${ids.a}`, { token, method: 'PATCH', body: { display_name: 'Must not replace A' }, headers: representation }); status(r, 200); ensure(Array.isArray(r.data) && r.data.length === 0, 'Other UUID was writable through user metadata'); return { ...evidence(r), rows: 0 };
  });
  await check('ordinary profile privilege escalation denied', async () => { const r = await request(`/profiles?id=eq.${ids.a}`, { token: tokenA, method: 'PATCH', body: { approved: false }, headers: representation }); status(r, 403); ensure(r.data?.code === '42501', 'Privileged profile fields were writable'); return evidence(r); });
  await check('own practice record uses verified subject', async () => {
    const r = await request('/practice_records?select=id,user_id', { token: tokenA, method: 'POST', body: { user_id: ids.a, recorded_date: '2026-10-11', memo: 'Synthetic API record' }, headers: representation }); status(r, 201); ensure(r.data.length === 1 && r.data[0].user_id === ids.a, 'Record owner differs from verified subject'); return { ...evidence(r), rows: 1 };
  });
  await check('other-subject practice record rejected by RLS', async () => { const r = await request('/practice_records', { token: tokenA, method: 'POST', body: { user_id: ids.b, recorded_date: '2026-10-11' }, headers: representation }); status(r, 403); ensure(r.data?.code === '42501', 'Other-subject record insertion passed'); return evidence(r); });
  await check('ordinary member has no member-management permission', async () => { const r = await request('/rpc/can_manage_members', { token: tokenA, method: 'POST', body: {} }); status(r, 200); ensure(r.data === false, 'Ordinary member unexpectedly manages members'); return evidence(r); });
  await check('multiple assigned roles combine permissions by OR', async () => { const r = await request('/rpc/can_manage_members', { token: tokenManager, method: 'POST', body: {} }); status(r, 200); ensure(r.data === true, 'Multiple roles lost their effective member-management permission'); return evidence(r); });
  await check('ordinary member cannot add allowed identities', async () => { const r = await request('/login_email_allowlist', { token: tokenA, method: 'POST', body: { email: extraEmail }, headers: representation }); status(r, 403); ensure(r.data?.code === '42501', 'Member expanded allowlist'); return evidence(r); });
  await check('permitted manager can add exact allowed identity', async () => { const r = await request('/login_email_allowlist?select=email', { token: tokenManager, method: 'POST', body: { email: extraEmail }, headers: representation }); status(r, 201); ensure(r.data.length === 1 && r.data[0].email === extraEmail, 'Manager allowlist add missing'); return { ...evidence(r), rows: 1 }; });
  await check('private draft hidden from unrelated member', async () => { const r = await request(`/notes?id=eq.${ids.privateNote}&select=id`, { token: tokenA }); status(r, 200); ensure(r.data.length === 0, 'Private draft leaked to unrelated member'); return { ...evidence(r), rows: 0 }; });
  await check('private draft readable by verified author', async () => { const r = await request(`/notes?id=eq.${ids.privateNote}&select=id`, { token: tokenB }); status(r, 200); ensure(r.data.length === 1 && r.data[0].id === ids.privateNote, 'Author lost private draft'); return { ...evidence(r), rows: 1 }; });
  await check('published note remains readable by member', async () => { const r = await request(`/notes?id=eq.${ids.publishedNote}&select=id`, { token: tokenA }); status(r, 200); ensure(r.data.length === 1, 'Published note lost member access'); return { ...evidence(r), rows: 1 }; });
  await check('authenticated token cannot execute service-only sync RPC', async () => { const r = await request('/rpc/claim_sheet_sync_chunk', { token: tokenA, method: 'POST', body: {} }); status(r, 403); ensure(r.data?.code === '42501', 'Member acquired service RPC privilege'); return evidence(r); });
  await check('signed service role retains private table read privilege', async () => { const r = await request('/confirmed_image_retirements?select=bucket&limit=0', { token: serviceToken }); status(r, 200); ensure(Array.isArray(r.data), 'Service role did not map to actual DB role'); return evidence(r); });
  await check('ordinary role cannot read private cleanup table', async () => { const r = await request('/confirmed_image_retirements?select=bucket&limit=0', { token: tokenA }); status(r, 403); ensure(r.data?.code === '42501', 'Private table privilege leaked'); return evidence(r); });
  await check('approved member can call guarded avatar RPC', async () => { const r = await request('/rpc/avatar_image_is_retired', { token: tokenA, method: 'POST', body: { p_path: `${ids.a}/absent.webp` } }); status(r, 200); ensure(r.data === false, 'Guarded avatar RPC wrong result'); return evidence(r); });
  await check('unapproved allowed identity rejected by avatar RPC', async () => { const r = await request('/rpc/avatar_image_is_retired', { token: tokenUnapproved, method: 'POST', body: { p_path: `${ids.a}/absent.webp` } }); status(r, 403); ensure(r.data?.code === '42501', 'RPC skipped current membership guard'); return evidence(r); });
  await check('manager revokes exact external identity', async () => { const r = await request(`/login_email_allowlist?email=eq.${encodeURIComponent(emails.a)}&select=email`, { token: tokenManager, method: 'DELETE', headers: representation }); status(r, 200); ensure(r.data.length === 1 && r.data[0].email === emails.a, 'Manager revoke did not affect exactly one row'); return { ...evidence(r), rows: 1 }; });
  for (const [name, path, options] of [
    ['same existing JWT profile read rejected after revoke', '/profiles?select=id', {}],
    ['same existing JWT ordinary save rejected after revoke', `/profiles?id=eq.${ids.a}`, { method: 'PATCH', body: { display_name: 'Must not save revoked session' }, headers: representation }],
    ['same existing JWT definer RPC rejected after revoke', '/rpc/avatar_image_is_retired', { method: 'POST', body: { p_path: `${ids.a}/absent.webp` } }]
  ]) await check(name, async () => { const r = await request(path, { token: tokenA, ...options }); status(r, 403); ensure(r.data?.code === 'PT403', 'Existing session bypassed current pre-request allowlist'); return evidence(r); });
  await check('revocation retains same UUID identity and prior saved profile', async () => { ensure(last(await sql(`SELECT count(*) FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.id='${ids.a}' AND p.display_name='Synthetic API saved profile';`)) === '1', 'Revoke removed identity or changed profile'); return { retainedIdentities: 1 }; });
  report.success = true;
} catch (error) {
  report.success = false; report.failure = `${stage}: ${safe(error.message)}`;
} finally {
  try {
    if (seeded) await sql(`${service} DELETE FROM public.notes WHERE id IN ('${ids.privateNote}','${ids.publishedNote}'); DELETE FROM public.practice_records WHERE user_id IN ('${ids.a}','${ids.b}'); DELETE FROM public.login_email_allowlist WHERE email IN (${[...Object.values(emails), extraEmail].map(email => `'${email}'`).join(',')}); DELETE FROM auth.users WHERE id IN (${Object.keys(emails).map(key => `'${ids[key]}'`).join(',')}); DELETE FROM public.roles WHERE id IN ('${ids.neutralRole}','${ids.managerRole}');`);
    report.resourceCleanup = await cleanupOwned({ generation, attempted, docker });
    report.cleanup = true;
  } catch (error) { report.cleanup = false; report.cleanupFailure = safe(error.message); }
}
console.log(JSON.stringify(report));
if (!report.success || !report.cleanup) process.exitCode = 1;
