// Only the reviewed launcher may supply a newly owned, unpublished SQL fixture.
// No production discovery, credentials, HTTP, GAS or container creation occurs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PG_IMAGE = 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00';
const OWNER = 'codex-auth-db-review';
const prefix = 'codex-auth-dbreview-';
const last = output => output.trim().split(/\r?\n/).at(-1);
const result = output => JSON.parse(output.trim().split(/\r?\n/).filter(line => line.startsWith('{')).at(-1));
const sha = value => createHash('sha256').update(value).digest('hex');
const sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

export async function runSheetRaces({ sql }) {
  if (typeof sql !== 'function') throw Error('Reviewed isolated SQL transport required');
  await sql(`DO $$ BEGIN IF current_database()<>'tuat_rls_review' OR EXISTS(SELECT 1 FROM auth.users)
    OR EXISTS(SELECT 1 FROM public.profiles) OR EXISTS(SELECT 1 FROM public.sheet_push_attempts)
    OR EXISTS(SELECT 1 FROM public.sheet_pending_clears) THEN RAISE EXCEPTION 'Fresh empty synthetic database required'; END IF; END $$;`);
  const profiles = [randomUUID(), randomUUID()];
  const records = Array.from({ length: 8 }, randomUUID);
  const emails = profiles.map(id => `sheet-race-${id}@example.invalid`);
  const attemptIds = Array.from({ length: 12 }, randomUUID);
  const suffix = randomUUID().slice(0, 8);
  const cfg = profile => `(SELECT jsonb_build_object('sheet_name',sheet_name,'record_fields',record_fields,'sheet_transition',sheet_transition,
    'sheet_header_signature',sheet_header_signature,'record_source',record_source) FROM public.profiles WHERE id='${profile}')`;
  const role = `SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
    SELECT set_config('request.headers','{}',false); SET statement_timeout='18s'; SET lock_timeout='12s';`;
  const fixtureRole = `${role} SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',false);`;
  const begin = (index, attemptIndex, slot = `slot-${index}`, payload = `payload-${index}`) => {
    const profile = profiles[index === 1 ? 1 : 0];
    return `SELECT public.sheet_push_begin('${attemptIds[attemptIndex]}','record','${records[index]}','${profile}',
      (SELECT recorded_date FROM public.practice_records WHERE id='${records[index]}'),
      (SELECT updated_at FROM public.practice_records WHERE id='${records[index]}'),${cfg(profile)},
      '${sha(slot)}','${sha(`target-${index}`)}','${sha(payload)}')`;
  };
  const finish = (index, attemptIndex) => `SELECT public.sheet_push_finish('${attemptIds[attemptIndex]}','${sha(`target-${index}`)}','${sha(`payload-${index}`)}',true)`;
  const clear = (date, attemptIndex) => `SELECT public.sheet_push_begin('${attemptIds[attemptIndex]}','clear',NULL,'${profiles[0]}',DATE '${date}',
    (SELECT created_at FROM public.sheet_pending_clears WHERE user_id='${profiles[0]}' AND recorded_date=DATE '${date}'),
    ${cfg(profiles[0])},'${sha(`clear-slot-${date}`)}','${sha(`clear-target-${date}`)}','${sha(`clear-payload-${date}`)}')`;
  const pending = new Set();
  const start = statement => {
    const task = sql(statement).then(output => ({ ok: true, output }), error => ({ ok: false, error }));
    pending.add(task); task.finally(() => pending.delete(task)); return task;
  };
  async function waitFor(name, event) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (last(await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='${event}';`)) === '1') return;
      await sleep(50);
    }
    throw Error('Required two-session SQL lock boundary was not reached');
  }
  let raceNumber = 0;
  async function race(first, second, rejectSecond = false, between = async () => {}) {
    const aName = `sheet-a-${suffix}-${++raceNumber}`, bName = `sheet-b-${suffix}-${raceNumber}`;
    const a = start(`SET application_name='${aName}';${role} BEGIN; ${first}; SELECT pg_sleep(3); COMMIT;`);
    await waitFor(aName, 'Timeout');
    await between();
    const b = start(`SET application_name='${bName}';${role} BEGIN; ${second}; COMMIT;`);
    await waitFor(bName, 'Lock');
    const [aResult, bResult] = await Promise.all([a, b]);
    assert.equal(aResult.ok, true, 'First SQL transaction must commit');
    assert.equal(bResult.ok, !rejectSecond, 'Second SQL transaction must observe committed barrier');
    if (rejectSecond) assert.match(String(bResult.error), /Unresolved sheet write/);
    return [aResult, bResult];
  }
  let passed = 0;
  try {
    await sql(`${fixtureRole}
      INSERT INTO auth.users(id,email) VALUES('${profiles[0]}','${emails[0]}'),('${profiles[1]}','${emails[1]}');
      INSERT INTO public.login_email_allowlist(email,created_by) VALUES('${emails[0]}','${profiles[0]}'),('${emails[1]}','${profiles[1]}');
      UPDATE public.profiles SET sheet_name='Synthetic race workbook',record_fields='[{"key":"memo","header":"Synthetic"}]',
        sheet_transition='{"version":"2026-10","mode":"sheet"}',sheet_header_signature='synthetic-race',record_source='sheet'
        WHERE id IN('${profiles.join("','")}');
      INSERT INTO public.practice_records(id,user_id,recorded_date,memo,updated_at,pending_sheet_push,from_sheet) VALUES
      ${records.map((id, index) => `('${id}','${profiles[index === 1 ? 1 : 0]}',DATE '2102-01-01'+${index},'Synthetic ${index}',TIMESTAMPTZ '2026-10-11 01:00:00Z',true,false)`).join(',')};
      INSERT INTO public.sheet_pending_clears(user_id,recorded_date) VALUES('${profiles[0]}',DATE '2102-02-01');`);

    let pair = await race(begin(0, 0), begin(0, 1));
    assert.equal(result(pair[0].output).outcome, 'send'); assert.equal(result(pair[1].output).outcome, 'blocked'); passed++;

    // Distinct profiles avoid a shared profile lock; shared slot advisory lock
    // serializes the new reservation, with the unique index as a final guard.
    pair = await race(begin(2, 2, 'shared-target'), begin(1, 3, 'shared-target'));
    assert.equal(result(pair[0].output).outcome, 'send'); assert.equal(result(pair[1].output).outcome, 'blocked'); passed++;

    // A new SQL session has no memory of the first response; age/edit/date/deletion never release it.
    await sql(`${role} UPDATE public.sheet_push_attempts SET created_at=TIMESTAMPTZ '1900-01-01' WHERE attempt_id='${attemptIds[0]}';
      UPDATE public.practice_records SET memo='Synthetic unknown edit',recorded_date=DATE '2102-03-01' WHERE id='${records[0]}';`);
    assert.equal(result(await sql(`${role}${begin(0, 4)}`)).outcome, 'blocked');
    await sql(`${role} DELETE FROM public.practice_records WHERE id='${records[0]}';`);
    assert.equal(last(await sql(`SELECT count(*) FROM public.sheet_push_attempts WHERE attempt_id='${attemptIds[0]}' AND state='reserved';`)), '1');
    assert.equal(result(await sql(`${role} SELECT public.sheet_clear_resolve('${profiles[0]}',DATE '2102-01-01',
      (SELECT created_at FROM public.sheet_pending_clears WHERE user_id='${profiles[0]}' AND recorded_date=DATE '2102-01-01'),${cfg(profiles[0])},'${sha('slot-0')}');`)).outcome, 'blocked'); passed++;

    assert.equal(result(await sql(`${role}${begin(3, 5)}`)).outcome, 'send');
    pair = await race(`UPDATE public.practice_records SET memo='Synthetic edit wins' WHERE id='${records[3]}'`, finish(3, 5));
    assert.deepEqual(result(pair[1].output), { outcome: 'completed', marker_status: 'superseded' });
    assert.equal(last(await sql(`SELECT pending_sheet_push FROM public.practice_records WHERE id='${records[3]}';`)), 't'); passed++;

    assert.equal(result(await sql(`${role}${begin(4, 6)}`)).outcome, 'send');
    await race(finish(4, 6), `UPDATE public.practice_records SET memo='Synthetic newer edit after finish' WHERE id='${records[4]}'`);
    assert.equal(last(await sql(`SELECT pending_sheet_push FROM public.practice_records WHERE id='${records[4]}';`)), 't');
    assert.equal(result(await sql(`${role}${begin(4, 7, 'slot-4', 'newer-payload-4')}`)).outcome, 'send'); passed++;

    await race(clear('2102-02-01', 8), `INSERT INTO public.practice_records(id,user_id,recorded_date,memo,from_sheet,synced_at)
      VALUES('${records[6]}','${profiles[0]}',DATE '2102-02-01','Synthetic rejected CSV',true,clock_timestamp())`, true);
    assert.equal(last(await sql(`SELECT count(*) FROM public.practice_records WHERE user_id='${profiles[0]}' AND recorded_date=DATE '2102-02-01';`)), '0'); passed++;

    pair = await race(`INSERT INTO public.practice_records(id,user_id,recorded_date,memo,from_sheet,synced_at)
      VALUES('${randomUUID()}','${profiles[0]}',DATE '2102-02-02','Synthetic CSV wins',true,clock_timestamp())`, clear('2102-02-02', 9), false,
      () => sql(`${role} INSERT INTO public.sheet_pending_clears(user_id,recorded_date) VALUES('${profiles[0]}',DATE '2102-02-02');`));
    assert.equal(result(pair[1].output).outcome, 'stale');
    assert.equal(last(await sql(`SELECT count(*) FROM public.sheet_push_attempts WHERE attempt_id='${attemptIds[9]}';`)), '0'); passed++;

    await sql(`${role} INSERT INTO public.sheet_pending_clears(user_id,recorded_date) VALUES('${profiles[0]}',DATE '2102-01-08');`);
    pair = await race(begin(1, 10, 'resolve-shared'), `SELECT public.sheet_clear_resolve('${profiles[0]}',DATE '2102-01-08',
      (SELECT created_at FROM public.sheet_pending_clears WHERE user_id='${profiles[0]}' AND recorded_date=DATE '2102-01-08'),
      ${cfg(profiles[0])},'${sha('resolve-shared')}')`);
    assert.equal(result(pair[0].output).outcome, 'send'); assert.equal(result(pair[1].output).outcome, 'blocked');
    assert.equal(last(await sql(`SELECT count(*) FROM public.sheet_pending_clears WHERE user_id='${profiles[0]}' AND recorded_date=DATE '2102-01-08';`)), '1'); passed++;
    return { passed, realSql: true, syntheticOnly: true, providerCalls: 0, separateSessions: true };
  } finally {
    // Drain every launched session before exact synthetic cleanup. Never retry DML.
    await Promise.all([...pending]);
    await sql(`${fixtureRole} DELETE FROM public.sheet_push_attempts WHERE profile_id IN('${profiles.join("','")}');
      DELETE FROM public.practice_records WHERE user_id IN('${profiles.join("','")}');
      DELETE FROM public.sheet_pending_clears WHERE user_id IN('${profiles.join("','")}');
      DELETE FROM public.login_email_allowlist WHERE email IN('${emails.join("','")}');
      DELETE FROM public.profiles WHERE id IN('${profiles.join("','")}'); DELETE FROM auth.users WHERE id IN('${profiles.join("','")}');`);
  }
}

function command(args, input = '') {
  const wsl = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(wsl, ['-d', 'Ubuntu', '--', 'docker', ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', failure;
    const stop = message => { failure ??= Error(message); child.kill(); };
    const timer = setTimeout(() => stop('Owned synthetic SQL transport timed out'), 25000);
    child.stdout.on('data', chunk => { if (out.length + chunk.length > 65536) stop('Owned SQL output exceeded bound'); else out += chunk; });
    child.stderr.on('data', chunk => { if (err.length + chunk.length > 16384) stop('Owned SQL error exceeded bound'); else err += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (failure) reject(failure); else if (code === 0) resolvePromise(out); else reject(Error(err || 'Owned SQL transport failed')); });
    child.stdin.on('error', () => stop('Owned SQL input closed unexpectedly'));
    child.stdin.end(input);
  });
}
async function ownedSql(container) {
  if (process.platform !== 'win32' || !/^codex-auth-dbreview-[a-f0-9]{32}$/.test(container ?? '')) throw Error('Exact Windows newly owned fixture required');
  const generation = container.slice(prefix.length);
  const state = JSON.parse(await command(['inspect', container]))[0];
  if (state.Name !== `/${container}` || state.Config.Labels?.['tuat.owner'] !== OWNER || state.Config.Labels?.['tuat.generation'] !== generation ||
      state.Image !== PG_IMAGE || !/^[a-f0-9]{64}$/.test(state.Id) || state.HostConfig.NetworkMode !== `${container}-internal` ||
      Object.keys(state.HostConfig.PortBindings ?? {}).length || Object.keys(state.NetworkSettings.Networks).length !== 1 ||
      !state.Mounts.some(mount => mount.Type === 'volume' && mount.Name === `${container}-data` && mount.Destination === '/var/lib/postgresql/data')) throw Error('Fresh pinned unpublished fixture boundary failed');
  const network = JSON.parse(await command(['network', 'inspect', `${container}-internal`]))[0];
  const volume = JSON.parse(await command(['volume', 'inspect', `${container}-data`]))[0];
  if (!network.Internal || network.Labels?.['tuat.owner'] !== OWNER || network.Labels?.['tuat.generation'] !== generation ||
      volume.Labels?.['tuat.owner'] !== OWNER || volume.Labels?.['tuat.generation'] !== generation) throw Error('Owned internal network/volume proof failed');
  const sql = statement => command(['exec', '-i', state.Id, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'tuat_rls_review'], statement);
  if (last(await sql('SELECT system_identifier FROM pg_control_system();')) === '7686488340612984867') throw Error('Live database overlap prohibited');
  return sql;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [flag, container] = process.argv.slice(2);
    if (flag !== '--container' || process.argv.length !== 4) throw Error('Explicit newly owned container required');
    console.log(JSON.stringify(await runSheetRaces({ sql: await ownedSql(container) })));
  } catch (error) { console.error(`Synthetic sheet receipt race failed: ${error.message}`); process.exitCode = 1; }
}
