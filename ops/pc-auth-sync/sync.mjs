// Auth continuity only: no business tables, auth deletion, role copying or automatic retry.
import { createHash } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const emailOf = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const university = email => email.endsWith('@st.go.tuat.ac.jp');
const keyOf = operation => digest([operation.type, operation.row.id ?? operation.row.email]);
const validEmail = email => email.length <= 254 && emailPattern.test(email);

function identities(rows) {
  if (!Array.isArray(rows)) throw Error('Invalid Auth listing');
  const byId = new Map(), byEmail = new Map();
  for (const row of rows) {
    // Auth may include phone-only accounts. They are outside Google email provisioning.
    if (!uuid.test(row?.id ?? '') || byId.has(row.id)) throw Error('Invalid or duplicate Auth identity');
    byId.set(row.id, row);
    const email = emailOf(row.email);
    if (!email) continue;
    if (!validEmail(email) || byEmail.has(email)) throw Error('Invalid or conflicting Auth email');
    byEmail.set(email, row);
  }
  return { byId, byEmail };
}

function allowlist(rows) {
  if (!Array.isArray(rows)) throw Error('Invalid allowlist listing');
  const result = new Map();
  for (const row of rows) {
    if (!validEmail(row?.email ?? '') || emailOf(row.email) !== row.email || university(row.email) ||
        !uuid.test(row.created_by ?? '') || !Number.isFinite(Date.parse(row.created_at)) || result.has(row.email)) throw Error('Invalid allowlist row');
    result.set(row.email, { email: row.email, created_at: row.created_at, created_by: row.created_by });
  }
  return result;
}

const verifiedGoogle = user => typeof user.email_confirmed_at === 'string' && Number.isFinite(Date.parse(user.email_confirmed_at)) &&
  (user.app_metadata?.providers?.includes('google') || user.identities?.some(identity => identity.provider === 'google'));

/** PC allowlist is authoritative; cloud Auth is authoritative for new identity UUIDs. */
export function planSync(snapshot) {
  const pc = identities(snapshot.pcUsers), cloud = identities(snapshot.cloudUsers);
  const localAllow = allowlist(snapshot.pcAllowlist), remoteAllow = allowlist(snapshot.cloudAllowlist);
  if (!Array.isArray(snapshot.pcProfiles)) throw Error('Invalid profile listing');
  const profiles = new Map();
  for (const row of snapshot.pcProfiles) {
    if (!uuid.test(row?.id ?? '') || !validEmail(emailOf(row.email)) || profiles.has(row.id)) throw Error('Invalid profile identity');
    profiles.set(row.id, row);
  }
  const operations = [];
  // Remove revoked registration permission before adding any new permission.
  for (const row of remoteAllow.values()) if (!localAllow.has(row.email)) operations.push({ type: 'allowlist-delete', row });
  for (const row of localAllow.values()) {
    const remote = remoteAllow.get(row.email);
    if (!remote) operations.push({ type: 'allowlist-insert', row });
    else if (digest(remote) !== digest(row)) operations.push({ type: 'allowlist-update', row, previous: remote });
  }
  for (const user of cloud.byId.values()) {
    const email = emailOf(user.email);
    if (!verifiedGoogle(user) || !email || (!university(email) && !localAllow.has(email))) continue;
    const existing = pc.byId.get(user.id), sameEmail = pc.byEmail.get(email), profile = profiles.get(user.id);
    if ((existing && emailOf(existing.email) !== email) || (sameEmail && sameEmail.id !== user.id) ||
        (profile && emailOf(profile.email) !== email)) throw Error('Identity conflict requires operator review');
    if (!existing) operations.push({ type: 'identity-insert', row: { id: user.id, email } });
    if (!profile) operations.push({ type: 'profile-insert', row: { id: user.id, email } });
  }
  return operations.map(operation => ({ ...operation, key: keyOf(operation) }));
}

export function summaryOf(plan) {
  return Object.fromEntries(['allowlist-delete', 'allowlist-insert', 'allowlist-update', 'identity-insert', 'profile-insert']
    .map(type => [type, plan.filter(operation => operation.type === type).length]));
}

function headers(side, extra = {}) {
  return { apikey: side.key, authorization: `Bearer ${side.key}`, ...(side.name === 'cloud' ? { 'x-tuat-mirror': '1' } : {}), ...extra };
}

async function request(side, path, options = {}, fetchRequest = fetch) {
  // The caller validates origins. Redirects never carry the dedicated service credential away.
  const response = await fetchRequest(side.url + path, { ...options, headers: headers(side, options.headers),
    redirect: 'error', signal: AbortSignal.timeout(60000), cache: 'no-store' });
  if (!response.ok) throw Error('Auth sync dependency request failed');
  return response.json(); // Missing/malformed bodies fail closed; never become an empty listing.
}

async function readRows(side, table, columns, order, fetchRequest) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await request(side, `/rest/v1/${table}?select=${columns}&order=${order}.asc&limit=1000&offset=${offset}`, {}, fetchRequest);
    if (!Array.isArray(page) || page.length > 1000) throw Error('Invalid table page');
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function readUsers(side, fetchRequest) {
  const users = [];
  for (let page = 1; ; page++) {
    const body = await request(side, `/auth/v1/admin/users?page=${page}&per_page=1000`, {}, fetchRequest);
    if (!Array.isArray(body?.users) || body.users.length > 1000) throw Error('Invalid Auth page');
    users.push(...body.users);
    if (body.users.length < 1000) return users;
  }
}

export async function readSnapshot({ pc, cloud }, fetchRequest = fetch) {
  const [pcUsers, cloudUsers, pcProfiles, pcAllowlist, cloudAllowlist] = await Promise.all([
    readUsers(pc, fetchRequest), readUsers(cloud, fetchRequest),
    readRows(pc, 'profiles', 'id,email', 'id', fetchRequest),
    readRows(pc, 'login_email_allowlist', 'email,created_at,created_by', 'email', fetchRequest),
    readRows(cloud, 'login_email_allowlist', 'email,created_at,created_by', 'email', fetchRequest),
  ]);
  const snapshot = { pcUsers, cloudUsers, pcProfiles, pcAllowlist, cloudAllowlist };
  planSync(snapshot); // Detect conflicts/malformed reads before the first write.
  return snapshot;
}

/** Only the target identities/permission table are retained in the private snapshot. */
export function targetSnapshot(snapshot) {
  return { pcUsers: snapshot.pcUsers.map(({ id, email }) => ({ id, email: emailOf(email) })).sort((a, b) => a.id.localeCompare(b.id)),
    pcProfiles: [...snapshot.pcProfiles].sort((a, b) => a.id.localeCompare(b.id)),
    cloudAllowlist: [...snapshot.cloudAllowlist].sort((a, b) => a.email.localeCompare(b.email)) };
}

export function effectPresent(operation, snapshot) {
  const { type, row } = operation;
  if (type === 'identity-insert') return snapshot.pcUsers.some(user => user.id === row.id && emailOf(user.email) === row.email);
  if (type === 'profile-insert') return snapshot.pcProfiles.some(profile => profile.id === row.id && emailOf(profile.email) === row.email);
  const remote = snapshot.cloudAllowlist.find(value => value.email === row.email);
  return type === 'allowlist-delete' ? !remote : !!remote && digest(remote) === digest(row);
}

export const pendingWrites = state => Object.values(state.operations ?? {}).some(operation => operation.status !== 'success');

/** Save running before dispatch; any failed/unknown result holds the whole adapter. */
export async function applyPlan({ plan, state, save, sides, fetchRequest = fetch, refresh = () => readSnapshot(sides, fetchRequest) }) {
  if (pendingWrites(state)) throw Error('Unresolved Auth sync journal requires read-only reconciliation');
  for (const operation of plan) {
    const current = await refresh();
    // Auth creation normally fires the profile trigger; concurrent callback creation is also respected.
    if (effectPresent(operation, current)) continue;
    if (!planSync(current).some(value => value.key === operation.key && digest(value) === digest(operation))) throw Error('Auth sync source changed; repeat dry-run');
    const record = { type: operation.type, status: 'running', desired: digest(operation), startedAt: new Date().toISOString() };
    state.operations[operation.key] = record;
    await save(state);
    try {
      let body;
      const json = { 'content-type': 'application/json', Prefer: 'return=representation' };
      if (operation.type === 'identity-insert') {
        body = await request(sides.pc, '/auth/v1/admin/users', { method: 'POST', headers: json,
          body: JSON.stringify({ ...operation.row, email_confirm: true, app_metadata: { provider: 'google', providers: ['google'] } }) }, fetchRequest);
        const user = body?.user ?? body;
        if (user?.id !== operation.row.id || emailOf(user.email) !== operation.row.email) throw Error('Unconfirmed identity write');
      } else {
        const profile = operation.type === 'profile-insert';
        const field = profile ? 'id' : 'email', value = operation.row[field];
        const filter = `${field}=eq.${encodeURIComponent(value)}`;
        const deleting = operation.type === 'allowlist-delete', updating = operation.type === 'allowlist-update';
        // Compare original audit fields too: changed permission metadata must be re-reviewed.
        const previous = deleting ? operation.row : operation.previous;
        const guard = previous ? `&created_at=eq.${encodeURIComponent(previous.created_at)}&created_by=eq.${previous.created_by}` : '';
        body = await request(profile ? sides.pc : sides.cloud, `/rest/v1/${profile ? 'profiles' : 'login_email_allowlist'}${deleting || updating ? `?${filter}${guard}` : ''}`, {
          method: deleting ? 'DELETE' : updating ? 'PATCH' : 'POST', headers: json,
          ...(!deleting ? { body: JSON.stringify(operation.row) } : {}),
        }, fetchRequest);
        if (!Array.isArray(body) || body.length !== 1 || body[0][field] !== value ||
            (profile ? emailOf(body[0].email) !== operation.row.email
              : digest({ email: body[0].email, created_at: body[0].created_at, created_by: body[0].created_by }) !== digest(operation.row))) throw Error('Unconfirmed row count or identity');
      }
      record.status = 'success';
    } catch {
      record.status = 'uncertain';
      record.finishedAt = new Date().toISOString();
      await save(state);
      throw Error('Auth sync stopped; reconcile the private journal before another write');
    }
    record.finishedAt = new Date().toISOString();
    await save(state);
  }
  return state;
}

/** A held operation clears only when its exact desired effect can be read back. */
export async function reconcile({ plan, state, snapshot, save }) {
  for (const [key, record] of Object.entries(state.operations)) {
    if (record.status === 'success') continue;
    const operation = plan.find(value => value.key === key && digest(value) === record.desired);
    if (operation && effectPresent(operation, snapshot)) {
      record.status = 'success'; record.reconciledAt = new Date().toISOString();
    } else record.status = 'uncertain';
  }
  await save(state);
  return { unresolved: Object.values(state.operations).filter(record => record.status !== 'success').length };
}
