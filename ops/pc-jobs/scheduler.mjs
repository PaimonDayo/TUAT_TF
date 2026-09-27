// UTC schedules copied from vercel.json. No network or production config on import.
export const JOBS = [
  { id: 'sheets', path: '/api/sheets/sync', method: 'POST', period: 86400000, offset: 15 * 3600000, timeout: 300000 },
  { id: 'program', path: '/api/competition-program/sync', method: 'POST', period: 300000, offset: 0, timeout: 60000 },
  { id: 'cleanup', path: '/api/cron/cleanup-stories', method: 'GET', period: 86400000, offset: 3 * 3600000 + 17 * 60000, timeout: 60000 },
];
export const slotAt = (job, now) => Math.floor((now - job.offset) / job.period) * job.period + job.offset;

export function initialState(activateAt) {
  if (!Number.isFinite(activateAt)) throw Error('An explicit activation boundary is required');
  return { version: 1, activateAt, jobs: {} };
}

export function validateState(state) {
  if (state?.version !== 1 || !Number.isFinite(state.activateAt) || !state.jobs || typeof state.jobs !== 'object' || Array.isArray(state.jobs)) throw Error('Invalid scheduler journal');
  for (const [id, value] of Object.entries(state.jobs)) {
    if (!JOBS.some(j => j.id === id) || !Number.isFinite(value.slot) || !['running', 'success', 'failed', 'uncertain'].includes(value.status)) throw Error('Invalid job journal');
  }
  return state;
}

/** Called once on startup. Never replay a request whose commit status is unknown. */
export function recoverState(state) {
  validateState(state);
  for (const value of Object.values(state.jobs)) if (value.status === 'running') value.status = 'uncertain';
  return state;
}

export function dueJobs(state, now) {
  validateState(state);
  return JOBS.filter(job => {
    const slot = slotAt(job, now), last = state.jobs[job.id];
    if (slot < state.activateAt || (last && last.status !== 'success')) return false;
    return !last || slot > last.slot;
  });
}

export function successfulPayload(job, value) {
  if (!value || typeof value !== 'object') return false;
  if (job.id === 'cleanup') return Number.isInteger(value.deleted) && value.deleted >= 0;
  if (value.ok !== true) return false;
  if (job.id === 'sheets') return Array.isArray(value.failedMembers) && value.failedMembers.length === 0;
  if (!Array.isArray(value.results)) return false;
  return value.results.every(result => !result.error && result.ok !== false);
}

/** Persist BEFORE dispatch. Serialize jobs; persist failures and require review. */
export async function tick({ state, now, save, execute, ready }) {
  if (!await ready()) return { skipped: 'backend-not-ready' };
  for (const job of dueJobs(state, now)) {
    if (!await ready()) break;
    const record = { slot: slotAt(job, now), status: 'running', startedAt: now };
    state.jobs[job.id] = record;
    await save(state); // Failure here must prevent the request.
    try {
      const result = await execute(job);
      record.status = result.ok && successfulPayload(job, result.value) ? 'success' : 'failed';
      record.httpStatus = result.status;
    } catch {
      record.status = 'uncertain';
    }
    record.finishedAt = Date.now();
    await save(state); // Failure stops the scheduler; startup sees running/uncertain.
  }
  return state;
}
