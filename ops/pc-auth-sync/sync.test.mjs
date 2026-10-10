import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { planSync, summaryOf, readSnapshot, applyPlan, pendingWrites, reconcile } from './sync.mjs';
import { validateConfig, run, writePrivate } from './run.mjs';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const allowed = email => ({ email, created_at: '2026-10-11T00:00:00+00:00', created_by: id(9) });
const user = (number, email, extra = {}) => ({ id: id(number), email, email_confirmed_at: '2026-10-11T00:00:00Z', app_metadata: { providers: ['google'] }, ...extra });
const snapshot = () => ({ pcUsers: [], pcProfiles: [], cloudUsers: [user(1, 'university@st.go.tuat.ac.jp'), user(2, 'permitted@example.test'), user(3, 'denied@example.test')],
  pcAllowlist: [allowed('permitted@example.test')], cloudAllowlist: [allowed('revoked@example.test')] });
const sides = { pc: { name: 'pc', url: 'http://127.0.0.1:18999', key: 'synthetic-pc-secret' }, cloud: { name: 'cloud', url: 'https://syntheticauth.supabase.co', key: 'synthetic-cloud-secret' } };

function mockTransport(data, { unknownIdentity = false, zeroDelete = false } = {}) {
  const writes = [];
  return { writes, fetchRequest: async (url, options = {}) => {
    const cloud = url.startsWith(sides.cloud.url), parsed = new URL(url);
    let body;
    if (!options.method) {
      body = parsed.pathname.startsWith('/auth/') ? { users: cloud ? data.cloudUsers : data.pcUsers }
        : parsed.pathname.endsWith('/profiles') ? data.pcProfiles : cloud ? data.cloudAllowlist : data.pcAllowlist;
    } else {
      writes.push({ url, options });
      const row = options.body ? JSON.parse(options.body) : undefined;
      if (parsed.pathname.startsWith('/auth/')) {
        data.pcUsers.push(user(Number(row.id.slice(-12)), row.email));
        data.pcProfiles.push({ id: row.id, email: row.email, role: 'member', approved: true }); // existing DB trigger
        if (unknownIdentity) throw Error('synthetic lost response after commit');
        body = { id: row.id, email: row.email };
      } else if (parsed.pathname.endsWith('/profiles')) { data.pcProfiles.push(row); body = [row]; }
      else if (options.method === 'DELETE') {
        const email = parsed.searchParams.get('email').slice(3), match = data.cloudAllowlist.find(value => value.email === email);
        if (zeroDelete) body = [];
        else { data.cloudAllowlist = data.cloudAllowlist.filter(value => value.email !== email); body = [match]; }
      } else {
        data.cloudAllowlist = data.cloudAllowlist.filter(value => value.email !== row.email); data.cloudAllowlist.push(row); body = [row];
      }
    }
    return { ok: true, json: async () => structuredClone(body) };
  } };
}

test('dry plan permits university and exact external allowlist, preserves UUIDs and omits privileges', () => {
  const data = snapshot(), plan = planSync(data);
  assert.deepEqual(summaryOf(plan), { 'allowlist-delete': 1, 'allowlist-insert': 1, 'allowlist-update': 0, 'identity-insert': 2, 'profile-insert': 2 });
  assert.equal(plan[0].type, 'allowlist-delete');
  assert.deepEqual(plan.filter(value => value.type === 'identity-insert').map(value => value.row.id), [id(1), id(2)]);
  assert(plan.every(value => !('role' in value.row) && !('approved' in value.row)));
  data.pcUsers = [user(1, 'university@st.go.tuat.ac.jp')]; data.pcProfiles = [{ id: id(1), email: 'university@st.go.tuat.ac.jp', role: 'admin', approved: true }];
  assert(!planSync(data).some(value => value.row.id === id(1))); // existing profile authority stays on PC
});

test('unconfirmed/non-Google users and removed external permission cannot provision', () => {
  const data = snapshot(); data.pcAllowlist = [];
  data.cloudUsers.push(user(4, 'other@st.go.tuat.ac.jp', { email_confirmed_at: null }), user(5, 'password@st.go.tuat.ac.jp', { app_metadata: { providers: ['email'] } }));
  assert.deepEqual(planSync(data).filter(value => value.type === 'identity-insert').map(value => value.row.id), [id(1)]);
});

test('same email/different UUID, changed identity email, malformed allowlist fail before mutations', () => {
  for (const mutate of [ data => { data.pcUsers = [user(9, 'permitted@example.test')]; },
    data => { data.pcUsers = [user(2, 'different@example.test')]; }, data => { data.pcProfiles = [{ id: id(2), email: 'different@example.test' }]; },
    data => { data.pcAllowlist[0].email = 'Uppercase@example.test'; } ]) { const data = snapshot(); mutate(data); assert.throws(() => planSync(data)); }
});

test('independent config pins loopback and cloud project and requires its dedicated keys', () => {
  const config = { version: 1, enabled: false, environmentFile: process.cwd(), stateDirectory: process.cwd(), sourceId: 'synthetic-pc', pcUrl: sides.pc.url,
    cloudAuthUrl: sides.cloud.url, cloudProjectRef: 'syntheticauth' };
  const env = { PC_AUTH_SYNC_SERVICE_ROLE_KEY: sides.pc.key, CLOUD_AUTH_SYNC_SERVICE_ROLE_KEY: sides.cloud.key };
  assert.deepEqual(validateConfig(config, env), sides);
  for (const altered of [{ ...config, pcUrl: 'https://public.example' }, { ...config, cloudProjectRef: 'other' }, { ...config, cloudAuthUrl: sides.cloud.url + '/path' }]) assert.throws(() => validateConfig(altered, env));
  assert.throws(() => validateConfig(config, { SUPABASE_SERVICE_ROLE_KEY: 'legacy-mirror-key' }));
});

test('malformed/failed listings never become zero users or an empty allowlist', async () => {
  await assert.rejects(readSnapshot(sides, async () => ({ ok: true, json: async () => ({}) })));
  await assert.rejects(readSnapshot(sides, async () => ({ ok: false, status: 503 })));
});

test('CLI defaults to dry-run with private target snapshot; check and disabled apply perform no data access', async () => {
  const directory = mkdtempSync(join(process.cwd(), '.tmp-auth-sync-'));
  try {
    const config = { version: 1, enabled: false, environmentFile: join(directory, 'synthetic.env'), stateDirectory: join(directory, 'state'),
      sourceId: 'synthetic-pc', pcUrl: sides.pc.url, cloudAuthUrl: sides.cloud.url, cloudProjectRef: 'syntheticauth' };
    writeFileSync(config.environmentFile, `PC_AUTH_SYNC_SERVICE_ROLE_KEY=${sides.pc.key}\nCLOUD_AUTH_SYNC_SERVICE_ROLE_KEY=${sides.cloud.key}\n`);
    const configFile = join(directory, 'config.json'); writeFileSync(configFile, JSON.stringify(config));
    const data = snapshot(), transport = mockTransport(data), privateFiles = [];
    assert.deepEqual(await run(configFile, '--check', { fetchRequest: () => { throw Error('must not read'); } }), { valid: true, enabled: false, reads: false, writes: false });
    const preview = await run(configFile, undefined, { fetchRequest: transport.fetchRequest, save: (file, value) => privateFiles.push({ file, value }) });
    assert.equal(preview.dryRun, true); assert.equal(preview.writes, false); assert.equal(transport.writes.length, 0);
    assert.equal(privateFiles.length, 2);
    assert(!JSON.stringify(preview).includes('permitted@example.test'));
    assert(!JSON.stringify(privateFiles).includes(sides.pc.key)); assert(!JSON.stringify(privateFiles).includes(sides.cloud.key));
    await assert.rejects(run(configFile, '--apply', { fetchRequest: () => { throw Error('must not read'); } }), /disabled/);
  } finally { assert(directory.startsWith(process.cwd())); rmSync(directory, { recursive: true, force: true }); }
});

test('complete paginated Auth listing retains users beyond the first 1000', async () => {
  const users = Array.from({ length: 1001 }, (_, index) => user(index + 10, `member${index}@st.go.tuat.ac.jp`));
  let pages = 0;
  const fetched = await readSnapshot(sides, async url => {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/auth/')) {
      const page = Number(parsed.searchParams.get('page')); pages++;
      return { ok: true, json: async () => ({ users: url.startsWith(sides.cloud.url) ? users.slice((page - 1) * 1000, page * 1000) : [] }) };
    }
    return { ok: true, json: async () => [] };
  });
  assert.equal(fetched.cloudUsers.length, 1001); assert.equal(pages, 3);
  assert.equal(summaryOf(planSync(fetched))['identity-insert'], 1001);
});

test('enabled apply requires a matching private preview and snapshot, then completes synthetic reconciliation', async () => {
  const directory = mkdtempSync(join(process.cwd(), '.tmp-auth-sync-'));
  try {
    const config = { version: 1, enabled: true, environmentFile: join(directory, 'synthetic.env'), stateDirectory: join(directory, 'state'),
      sourceId: 'synthetic-pc', pcUrl: sides.pc.url, cloudAuthUrl: sides.cloud.url, cloudProjectRef: 'syntheticauth' };
    writeFileSync(config.environmentFile, `PC_AUTH_SYNC_SERVICE_ROLE_KEY=${sides.pc.key}\nCLOUD_AUTH_SYNC_SERVICE_ROLE_KEY=${sides.cloud.key}\n`);
    const configFile = join(directory, 'config.json'); writeFileSync(configFile, JSON.stringify(config));
    const data = snapshot(), transport = mockTransport(data);
    const options = { fetchRequest: transport.fetchRequest, save: (file, value) => writeFileSync(file, JSON.stringify(value)) };
    await assert.rejects(run(configFile, '--apply', options)); assert.equal(transport.writes.length, 0);
    await run(configFile, '--dry-run', options);
    data.pcAllowlist.push(allowed('added-during-review@example.test'));
    await assert.rejects(run(configFile, '--apply', options), /matching dry-run/); assert.equal(transport.writes.length, 0);
    await run(configFile, '--dry-run', options);
    const result = await run(configFile, '--apply', options);
    assert.equal(result.applied, true); assert(Object.values(result.remaining).every(count => count === 0));
    const stateText = readFileSync(join(config.stateDirectory, 'auth-sync-journal.json'), 'utf8');
    assert(!stateText.includes('permitted@example.test')); assert(!stateText.includes(sides.pc.key));
  } finally { assert(directory.startsWith(process.cwd())); rmSync(directory, { recursive: true, force: true }); }
});

test('private snapshot bytes are written only inside a verified private parent', () => {
  const directory = mkdtempSync(join(process.cwd(), '.tmp-auth-acl-'));
  try {
    const privateState = join(directory, 'protected');
    const file = join(privateState, 'synthetic-snapshot.json');
    writePrivate(file, { synthetic: true });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { synthetic: true });
    assert.deepEqual(readdirSync(privateState), ['synthetic-snapshot.json']);
    if (process.platform === 'win32') {
      const unsafe = join(directory, 'inherited'); mkdirSync(unsafe);
      assert.throws(() => writePrivate(join(unsafe, 'must-not-exist.json'), { synthetic: true }));
      assert.deepEqual(readdirSync(unsafe), []);
    }
  } finally { assert(directory.startsWith(process.cwd())); rmSync(directory, { recursive: true, force: true }); }
});

test('an unsafe existing state directory rejects before lock, row reads or receipt writes', async () => {
  if (process.platform !== 'win32') return;
  const directory = mkdtempSync(join(process.cwd(), '.tmp-auth-acl-'));
  try {
    const unsafe = join(directory, 'inherited'); mkdirSync(unsafe);
    const config = { version: 1, enabled: false, environmentFile: join(directory, 'synthetic.env'), stateDirectory: unsafe,
      sourceId: 'synthetic-pc', pcUrl: sides.pc.url, cloudAuthUrl: sides.cloud.url, cloudProjectRef: 'syntheticauth' };
    writeFileSync(config.environmentFile, `PC_AUTH_SYNC_SERVICE_ROLE_KEY=${sides.pc.key}\nCLOUD_AUTH_SYNC_SERVICE_ROLE_KEY=${sides.cloud.key}\n`);
    const configFile = join(directory, 'config.json'); writeFileSync(configFile, JSON.stringify(config));
    let read = 0, written = 0;
    await assert.rejects(run(configFile, '--dry-run', { fetchRequest: () => { read++; }, save: () => { written++; } }));
    assert.equal(read, 0); assert.equal(written, 0); assert.equal(existsSync(join(unsafe, 'auth-sync.lock')), false);
    assert.deepEqual(readdirSync(unsafe), []);
  } finally { assert(directory.startsWith(process.cwd())); rmSync(directory, { recursive: true, force: true }); }
});

test('an additional explicit Windows principal grant is rejected before another private write', () => {
  if (process.platform !== 'win32') return;
  const directory = mkdtempSync(join(process.cwd(), '.tmp-auth-acl-'));
  try {
    const state = join(directory, 'protected');
    writePrivate(join(state, 'initial.json'), { synthetic: true });
    execFileSync('icacls', [state, '/grant', '*S-1-1-0:(OI)(CI)(R)'], { stdio: 'ignore', windowsHide: true });
    assert.throws(() => writePrivate(join(state, 'must-not-exist.json'), { synthetic: true }));
    assert.deepEqual(readdirSync(state), ['initial.json']);
  } finally { assert(directory.startsWith(process.cwd())); rmSync(directory, { recursive: true, force: true }); }
});

test('a redirected state directory cannot receive snapshot bytes', () => {
  const directory = mkdtempSync(join(process.cwd(), '.tmp-auth-acl-'));
  try {
    const target = join(directory, 'target'), redirected = join(directory, 'redirected');
    mkdirSync(target); symlinkSync(target, redirected, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => writePrivate(join(redirected, 'must-not-exist.json'), { synthetic: true }));
    assert.deepEqual(readdirSync(target), []);
  } finally { assert(directory.startsWith(process.cwd())); rmSync(directory, { recursive: true, force: true }); }
});

test('end-to-end synthetic sync removes revoked allowlist, provisions permitted identities and respects profile trigger', async () => {
  const data = snapshot(), transport = mockTransport(data), state = { operations: {} }, saves = [];
  const read = () => readSnapshot(sides, transport.fetchRequest);
  const plan = planSync(await read());
  await applyPlan({ plan, state, sides, fetchRequest: transport.fetchRequest, refresh: read, save: async value => saves.push(structuredClone(value)) });
  assert.equal(pendingWrites(state), false);
  assert.deepEqual(planSync(await read()), []);
  assert.equal(transport.writes.filter(value => new URL(value.url).pathname.endsWith('/profiles')).length, 0);
  assert.equal(transport.writes.filter(value => new URL(value.url).pathname.startsWith('/auth/')).length, 2);
  assert(saves.some(value => Object.values(value.operations).some(record => record.status === 'running')));
  assert(transport.writes.every(value => value.options.redirect === 'error'));
  assert(transport.writes.filter(value => value.url.startsWith(sides.cloud.url)).every(value => value.options.headers['x-tuat-mirror'] === '1'));
});

test('lost response after identity commit holds writes until exact read-only reconciliation', async () => {
  const data = snapshot(), plan = planSync(data), transport = mockTransport(data, { unknownIdentity: true }), state = { operations: {} };
  const read = () => readSnapshot(sides, transport.fetchRequest);
  await assert.rejects(applyPlan({ plan, state, sides, fetchRequest: transport.fetchRequest, refresh: read, save: async () => {} }));
  const count = transport.writes.length;
  await assert.rejects(applyPlan({ plan, state, sides, fetchRequest: transport.fetchRequest, refresh: read, save: async () => {} }));
  assert.equal(transport.writes.length, count);
  assert.deepEqual(await reconcile({ plan, state, snapshot: await read(), save: async () => {} }), { unresolved: 0 });
  assert.equal(transport.writes.length, count);
});

test('zero affected rows and a journal persistence failure dispatch no subsequent writes', async () => {
  const data = snapshot(), transport = mockTransport(data, { zeroDelete: true }), state = { operations: {} }, plan = planSync(data);
  await assert.rejects(applyPlan({ plan, state, sides, fetchRequest: transport.fetchRequest, refresh: () => readSnapshot(sides, transport.fetchRequest), save: async () => {} }));
  assert.equal(transport.writes.length, 1); assert.equal(pendingWrites(state), true);
  const clean = snapshot(), second = mockTransport(clean);
  await assert.rejects(applyPlan({ plan: planSync(clean), state: { operations: {} }, sides, fetchRequest: second.fetchRequest,
    refresh: () => readSnapshot(sides, second.fetchRequest), save: async () => { throw Error('synthetic disk full'); } }));
  assert.equal(second.writes.length, 0);
});

test('revoked source while dry plan is pending is re-read before any grant', async () => {
  const data = snapshot(); data.cloudAllowlist = [];
  const plan = planSync(data); data.pcAllowlist = [];
  const transport = mockTransport(data);
  await assert.rejects(applyPlan({ plan, state: { operations: {} }, sides, fetchRequest: transport.fetchRequest,
    refresh: () => readSnapshot(sides, transport.fetchRequest), save: async () => {} }));
  assert.equal(transport.writes.length, 0);
});
