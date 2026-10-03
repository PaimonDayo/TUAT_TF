import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { JOBS, slotAt, initialState, recoverState, dueJobs, successfulPayload, tick } from './scheduler.mjs';
import { executeLocalJob, validateConfig } from './run.mjs';



const at = Date.parse('2026-09-25T15:05:00Z');
const payload = job => job.id === 'sheets' ? { ok: true, failedMembers: [] } : job.id === 'cleanup' ? { deleted: 0 } : { ok: true, results: [] };
const success = async job => ({ ok: true, status: 200, value: payload(job) });
test('approved schedules keep JST midnight, five-minute program and daily cleanup', () => {
  assert.deepEqual(JOBS.map(j=>j.id), ['sheets','program','cleanup']);
  assert.equal(new Date(slotAt(JOBS[0],at)).toISOString(),'2026-09-25T15:00:00.000Z');
  assert.equal(new Date(slotAt(JOBS[1],at)).toISOString(),'2026-09-25T15:05:00.000Z');
  assert.equal(new Date(slotAt(JOBS[2],at)).toISOString(),'2026-09-25T03:17:00.000Z');
});test('activation excludes slots owned by the old scheduler', () => {
  assert.equal(dueJobs(initialState(at + 1), at).length, 0);
  assert.deepEqual(dueJobs(initialState(at), at).map(j => j.id), ['program']);
});
test('successful slots persist across restart; downtime catches up only the latest slot', async () => {
  let state = initialState(at - 86400000), calls = [];
  await tick({ state, now: at, ready: async () => true, save: async () => {}, execute: async j => { calls.push(j.id); return success(j); } });
  state = recoverState(JSON.parse(JSON.stringify(state)));
  assert.equal(dueJobs(state, at).length, 0);
  assert.equal(calls.length, 3);
  assert.equal(dueJobs(state, at + 7 * 86400000).length, 3); // no seven-day burst
});
test('journal commit precedes execution; persistence failure dispatches nothing', async () => {
  let calls = 0;
  await assert.rejects(tick({ state: initialState(at), now: at, ready: async () => true,
    save: async () => { throw Error('disk full'); }, execute: async () => { calls++; } }));
  assert.equal(calls, 0);
});
test('crashed in-flight and ambiguous failures block later automatic dispatch', async () => {
  const state = initialState(at);
  state.jobs.program = { slot: at, status: 'running' };
  recoverState(state); assert.equal(state.jobs.program.status, 'uncertain');
  await tick({ state, now: at, ready: async () => true, save: async () => {}, execute: async () => { throw Error('lost after commit'); } });
  assert.equal(state.jobs.program.status, 'uncertain');
  assert.deepEqual(dueJobs(state, at + 3600000), []);
});
test('HTTP 200 partial failures and malformed payloads are not success', async () => {
  assert.equal(successfulPayload(JOBS[0], { ok: true, failedMembers: ['synthetic'] }), false);
  assert.equal(successfulPayload(JOBS[1], { ok: true, results: [{ error: 'failed' }] }), false);
  assert.equal(successfulPayload(JOBS[2], { ok: true, results: [{ ok: false }] }), false);
  assert.equal(successfulPayload(JOBS[2], {}), false);
  const state = initialState(at);
  await tick({ state, now: at, ready: async () => true, save: async () => {}, execute: async () => ({ ok: true, status: 200, value: {} }) });
  assert.equal(state.jobs.program.status, 'failed');
});
test('a failed sheet write holds all sheet writes but does not stop tomorrow imports', async () => {
  const state = initialState(at - 86400000);
  const failed = { slot: slotAt(JOBS[0], at), status: 'failed', httpStatus: 200 };
  state.jobs.sheets = { ...failed };
  let calls = [];
  await tick({ state, now: at, save: async () => {}, ready: async () => true, execute: async job => { calls.push(job); return success(job); } });
  assert(!calls.some(job => job.id === 'sheets')); // No same-slot replay.
  calls = [];
  await tick({ state, now: at + 86400000, save: async () => {}, ready: async () => true, execute: async job => {
    calls.push(job);
    return job.id === 'sheets' ? { ok: true, status: 200, value: { ok: true, failedMembers: [], sheetWritesSkipped: true } } : success(job);
  } });
  assert.equal(calls.find(job => job.id === 'sheets').skipSheetWrites, true);
  assert.equal(state.sheetWritesBlocked, true);
  assert.equal(state.jobs.sheets.status, 'partial');
  assert.deepEqual(state.sheetFailures, [failed]);
  assert(dueJobs(recoverState(JSON.parse(JSON.stringify(state))), at + 2 * 86400000).some(job => job.id === 'sheets'));
});

test('an older API that does not confirm held writes cannot be counted as a successful import-only run', () => {
  assert.equal(successfulPayload({ ...JOBS[0], skipSheetWrites: true }, { ok: true, failedMembers: [] }), false);
});
test('backend/backup maintenance guard prevents dispatch and preserves catch-up slot', async () => {
  const state = initialState(at);
  await tick({ state, now: at, ready: async () => false, save: async () => { assert.fail(); }, execute: async () => { assert.fail(); } });
  assert.deepEqual(state.jobs, {});
  assert.equal(dueJobs(state, at).length, 1);
});
test('loopback HTTP integration: exact path, method, body, credentials; one dispatch per slot', async () => {
  const calls = [];
  const server = createServer(async (request, response) => {
    const job = JOBS.find(j => j.path === request.url); assert(job);
    assert.equal(request.method, job.method);
    assert.equal(request.headers.authorization, `Bearer ${job.id === 'cleanup' ? 'test-cron' : 'test-sync'}`);
    let body = ''; for await (const chunk of request) body += chunk;
    assert.equal(body, job.method === 'POST' ? '{}' : '');
    calls.push(job.id); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(payload(job)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const state = initialState(at - 86400000);
    const args = { state, now: at, save: async () => {}, ready: async () => true,
      execute: j => executeLocalJob(base, { CRON_SECRET: 'test-cron', SHEET_SYNC_SECRET: 'test-sync' }, j) };
    await tick(args); await tick(args);
    assert.equal(calls.length, 3); assert(Object.values(state.jobs).every(j => j.status === 'success'));
    await assert.rejects(executeLocalJob('https://tuat-tf.vercel.app', {}, JOBS[0]));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('cloud database and incomplete local configuration fail closed', () => {
  assert.throws(() => validateConfig({}, {}));
  const base = process.cwd();
  const config = { version: 1, enabled: false, releaseDirectory: base, stateDirectory: base, backendDirectory: base, environmentFile: base, releaseCommit: 'a'.repeat(40), port: 3112, activateAt: new Date(at).toISOString() };
  assert.throws(() => validateConfig(config, { NEXT_PUBLIC_SUPABASE_URL: 'https://cloud.invalid' }));
});
