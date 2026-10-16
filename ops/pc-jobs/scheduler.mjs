// UTC schedules copied from vercel.json. No network or production config on import.
export const JOBS = [
  { id: 'sheets', path: '/api/sheets/sync', method: 'POST', period: 86400000, offset: 15 * 3600000, timeout: 300000 },
  { id: 'program', path: '/api/competition-program/sync', method: 'POST', period: 300000, offset: 0, timeout: 60000 },
  { id: 'cleanup', path: '/api/cron/cleanup-stories', method: 'GET', period: 86400000, offset: 3 * 3600000 + 17 * 60000, timeout: 60000 },
  { id: 'push', path: '/api/push/deliver', method: 'POST', period: 60000, offset: 0, timeout: 300000 },
];
export const slotAt = (job, now) => Math.floor((now - job.offset) / job.period) * job.period + job.offset;
const validPushBackoff = value => value.pendingBackoffMinutes === undefined || [1, 2, 4, 8, 15].includes(value.pendingBackoffMinutes);

export function initialState(activateAt) {
  if (!Number.isFinite(activateAt)) throw Error('An explicit activation boundary is required');
  return { version: 1, activateAt, jobs: {} };
}

export function validateState(state) {
  if (state?.version !== 1 || !Number.isFinite(state.activateAt) || !state.jobs || typeof state.jobs !== 'object' || Array.isArray(state.jobs)) throw Error('Invalid scheduler journal');
  for (const [id, value] of Object.entries(state.jobs)) {
    if (!JOBS.some(j => j.id === id) || !Number.isFinite(value.slot) || !['running', 'success', 'partial', 'failed', 'uncertain'].includes(value.status)) throw Error('Invalid job journal');
    if (id === 'push' && !validPushBackoff(value)) throw Error('Invalid push backoff');
  }
  if (state.pushFailures !== undefined) {
    if (!Array.isArray(state.pushFailures)) throw Error('Invalid push failure history');
    let previous = -Infinity;
    for (const value of state.pushFailures) {
      if (!value || !Number.isFinite(value.slot) || value.slot <= previous || !(value.slot < state.jobs.push?.slot)
        || !['failed', 'uncertain'].includes(value.status) || !validPushBackoff(value)
        || ['startedAt', 'finishedAt'].some(key => key in value && !Number.isFinite(value[key]))
        || ('startedAt' in value && 'finishedAt' in value && value.finishedAt < value.startedAt)
        || ('httpStatus' in value && (!Number.isInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599))) throw Error('Invalid push failure history');
      previous = value.slot;
    }
  }
  return state;
}

/** Called once on startup. Never replay a request whose commit status is unknown. */
export function recoverState(state) {
  validateState(state);
  for (const value of Object.values(state.jobs)) if (value.status === 'running') value.status = 'uncertain';
  return state;
}

export function dueJobs(state, now, localPushEnabled = false) {
  validateState(state);
  return JOBS.filter(job => {
    if (job.id === 'push' && !localPushEnabled) return false;
    const slot = slotAt(job, now), last = state.jobs[job.id];
    const canContinue = last && (job.id === 'sheets' && ['partial', 'failed', 'uncertain'].includes(last.status)
      || job.id === 'push' && ['failed', 'uncertain'].includes(last.status));
    if (slot < state.activateAt || (last && last.status !== 'success' && !canContinue)) return false;
    if (job.id === 'push' && canContinue && slot < last.slot + (last.pendingBackoffMinutes ?? 1) * job.period) return false;
    return !last || slot > last.slot;
  });
}

export function successfulPayload(job, value) {
  if (!value || typeof value !== 'object') return false;
  if (job.id === 'cleanup') return Number.isInteger(value.deleted) && value.deleted >= 0;
  if (value.ok !== true) return false;
  if (job.id === 'sheets') return Array.isArray(value.failedMembers) && value.failedMembers.length === 0
    && (!job.skipSheetWrites || value.sheetWritesSkipped === true);
  if (job.id === 'push') return ['sent','dropped','failed','uncertain'].every(key => Number.isInteger(value[key]) && value[key] >= 0)
    && value.failed === 0 && value.uncertain === 0;
  if (!Array.isArray(value.results)) return false;
  return value.results.every(result => !result.error && result.ok !== false);
}

/** Persist BEFORE dispatch. Later push cycles select pending DB items only;
 * failed/uncertain/claimed items remain guarded by the delivery API. */
export async function tick({ state, now, save, execute, ready, localPushEnabled = false }) {
  if (!await ready()) return { skipped: 'backend-not-ready' };
  for (const job of dueJobs(state, now, localPushEnabled)) {
    if (!await ready()) break;
    const previous = state.jobs[job.id];
    if (job.id === 'push' && previous && ['failed', 'uncertain'].includes(previous.status)) {
      // Preserve the old request outcome, including an interrupted startup record.
      // This is a new slot with an empty request body, never a resend of that slot.
      state.pushFailures ??= [];
      state.pushFailures.push({ ...previous });
    }
    if (job.id === 'sheets' && previous && previous.status !== 'success' && previous.sheetWritesUncertain !== false) {
      state.sheetWritesBlocked = true;
      state.sheetFailures ??= [];
      if (['failed', 'uncertain'].includes(previous.status) && !state.sheetFailures.some(value => value.slot === previous.slot)) state.sheetFailures.push({ ...previous });
    }
    const dispatch = job.id === 'sheets' && state.sheetWritesBlocked ? { ...job, skipSheetWrites: true } : job;
    const record = { slot: slotAt(job, now), status: 'running', startedAt: now };
    if (job.id === 'push') record.pendingBackoffMinutes = previous && ['failed', 'uncertain'].includes(previous.status)
      ? Math.min(15, (previous.pendingBackoffMinutes ?? 1) * 2) : 1;
    if (dispatch.skipSheetWrites) record.sheetWritesSkipped = true;
    state.jobs[job.id] = record;
    await save(state); // Failure here must prevent the request.
    try {
      const result = await execute(dispatch);
      record.status = result.ok && successfulPayload(dispatch, result.value) ? (dispatch.skipSheetWrites ? 'partial' : 'success') : 'failed';
      record.httpStatus = result.status;
      if (job.id === 'sheets') record.sheetWritesUncertain = result.ok && result.value?.sheetWritesUncertain === false ? false : record.status !== 'success';
    } catch {
      record.status = 'uncertain';
    }
    record.finishedAt = Date.now();
    if (job.id === 'push' && record.status === 'success') delete record.pendingBackoffMinutes;
    if (job.id === 'sheets' && ['failed', 'uncertain'].includes(record.status) && record.sheetWritesUncertain !== false) state.sheetWritesBlocked = true;
    await save(state); // Failure stops the scheduler; startup sees running/uncertain.
  }
  return state;
}
