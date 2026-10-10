// Confirmed retirements only. No import-time I/O, inventory, legacy queue or save replay.
import { createHash } from 'node:crypto';

export const SCHEMA_VERSION = '20261011150000';
export const GRACE_MS = (7 * 24 * 60 * 60 + 600) * 1000;
const CLOCK_MARGIN_MS = 120_000;
const pathPattern = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:webp|jpe?g)$/i;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const utc = value => typeof value === 'string' && /(?:Z|[+-]00:00)$/.test(value) && Number.isFinite(Date.parse(value));

export function validateConfig(config) {
  let pc;
  try { pc = new URL(config.pcUrl); } catch { throw Error('Pinned cleanup target required'); }
  if (config.version !== 1 || typeof config.enabled !== 'boolean' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(config.sourceId ?? '') ||
      pc.origin !== config.pcUrl || pc.protocol !== 'http:' || pc.hostname !== '127.0.0.1' || !pc.port ||
      pc.username || pc.password || !/^[0-9]{10,20}$/.test(config.systemIdentifier ?? '') ||
      !/^[a-z][a-z0-9_]{0,62}$/.test(config.database ?? '') ||
      !/^[a-f0-9]{32}$/.test(config.r2AccountId ?? '') || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.r2Bucket ?? '') ||
      config.requestTimeoutMs !== 330_000) throw Error('Explicit cleanup identity and bounded PC gateway required');
  return { sourceId: config.sourceId, pcUrl: config.pcUrl, systemIdentifier: config.systemIdentifier,
    database: config.database, r2AccountId: config.r2AccountId, r2Bucket: config.r2Bucket,
    schemaVersion: SCHEMA_VERSION, requestTimeoutMs: config.requestTimeoutMs };
}

function checkClock(value, now) {
  if (!utc(value) || Math.abs(Date.parse(value) - now) > CLOCK_MARGIN_MS) throw Error('Cleanup UTC clock check failed');
}
function checkTarget(value, identity, now) {
  if (value?.system_identifier !== identity.systemIdentifier || value?.database !== identity.database ||
      value?.schema_version !== SCHEMA_VERSION) throw Error('Cleanup database target mismatch');
  checkClock(value.server_utc, now);
}
function validateRow(row) {
  if (!row || !['avatars','note-images'].includes(row.bucket) || !pathPattern.test(row.path ?? '') ||
      !utc(row.confirmed_at) || row.deleted_at !== null ||
      !((row.closed_at === null && row.delete_after === null) ||
        (utc(row.closed_at) && utc(row.delete_after) && Date.parse(row.closed_at) >= Date.parse(row.confirmed_at) &&
          Date.parse(row.delete_after) - Date.parse(row.closed_at) >= GRACE_MS))) throw Error('Invalid confirmed cleanup row');
  return { bucket: row.bucket, path: row.path, confirmed_at: row.confirmed_at,
    closed_at: row.closed_at, delete_after: row.delete_after, deleted_at: null };
}

export async function captureSnapshot(config, adapter, now = Date.now()) {
  const identity = validateConfig(config);
  checkTarget(await adapter.target(), identity, now);
  const rows = await adapter.confirmed(100,new Date(now).toISOString());
  if (!Array.isArray(rows) || rows.length > 100) throw Error('Invalid bounded cleanup listing');
  const confirmed = rows.map(validateRow).sort((a,b) => `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`));
  if (new Set(confirmed.map(row => `${row.bucket}/${row.path}`)).size !== confirmed.length) throw Error('Duplicate cleanup row');
  checkTarget(await adapter.target(), identity, now);
  return { version: 1, identity, rows: confirmed, hash: hash({ identity, rows: confirmed }) };
}

export function dryRun(snapshot) {
  return { version: 1, snapshotHash: snapshot.hash, targetHash: hash(snapshot.identity), snapshot,
    counts: { confirmed: snapshot.rows.length, awaitingClosure: snapshot.rows.filter(row => row.closed_at === null).length } };
}

export async function applyCleanup(config, adapter, preview, { now = () => Date.now() } = {}) {
  validateConfig(config);
  if (!config.enabled) throw Error('Confirmed image cleanup is disabled');
  if (preview?.version !== 1 || preview.snapshotHash !== preview.snapshot?.hash ||
      preview.targetHash !== hash(preview.snapshot?.identity)) throw Error('Correct-target snapshot and dry run required');
  const current = await captureSnapshot(config, adapter, now());
  if (current.hash !== preview.snapshotHash) throw Error('Cleanup changed since dry run');
  const started = now(); const counts = { confirmed: current.rows.length, closed: 0, deleted: 0, retained: 0 };
  for (const candidate of current.rows) {
    if (now() - started >= 20_000) break;
    const claim = await adapter.claim(candidate.bucket,candidate.path);
    if (claim === null) { counts.retained++; continue; }
    const row = validateRow(claim);
    if (row.bucket !== candidate.bucket || row.path !== candidate.path || row.confirmed_at !== candidate.confirmed_at) throw Error('Cleanup claim mismatch');
    checkClock(claim.server_utc,now());
    if (!row.closed_at) throw Error('Unclosed cleanup claim');
    if (!candidate.closed_at) counts.closed++;
    if (Date.parse(row.delete_after) > now() || Date.parse(row.delete_after) > Date.parse(claim.server_utc)) { counts.retained++; continue; }
    // Recheck UTC and the stable database identity immediately before DELETE.
    const target = await adapter.target(); checkTarget(target,current.identity,now());
    if (Date.parse(target.server_utc) < Date.parse(row.delete_after)) throw Error('Cleanup grace has not elapsed');
    await adapter.remove(`${row.bucket}/${row.path}`);
    if (await adapter.finish(row.bucket,row.path,row.closed_at) !== true) throw Error('Cleanup acknowledgement unavailable');
    counts.deleted++;
  }
  return counts;
}
