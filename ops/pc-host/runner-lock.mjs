import {
  openSync, closeSync, writeFileSync, fsyncSync, lstatSync, fstatSync,
  readSync, realpathSync, unlinkSync, constants,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve, parse } from 'node:path';

const MAX_LOCK_BYTES = 4096;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sameIdentity(a, b) {
  return a.dev === b.dev && a.ino === b.ino &&
    a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function sameSnapshot(a, b) {
  return sameIdentity(a.stat, b.stat) && a.bytes.equals(b.bytes);
}

function appDirectory(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw fail('ERR_PC_APP_LOCK_INVALID_DIRECTORY', 'An absolute dedicated app state directory is required.');
  }
  const path = resolve(directory);
  if (path === parse(path).root) {
    throw fail('ERR_PC_APP_LOCK_INVALID_DIRECTORY', 'A filesystem root cannot be app state.');
  }
  try {
    const stat = lstatSync(path);
    const actual = realpathSync(path);
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (!stat.isDirectory() || stat.isSymbolicLink() || normalize(actual) !== normalize(path)) {
      throw Error('Non-dedicated directory');
    }
  } catch {
    throw fail('ERR_PC_APP_LOCK_INVALID_DIRECTORY', 'App state must be an existing directory without redirected ancestors.');
  }
  return path;
}

function snapshot(path) {
  let descriptor;
  try {
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1n || before.size > BigInt(MAX_LOCK_BYTES)) {
      throw fail('ERR_PC_APP_LOCK_INVALID', 'The app runner lock is invalid; operator review is required.');
    }
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    const current = lstatSync(path, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink() ||
        !sameIdentity(before, opened) || !sameIdentity(opened, current)) {
      throw fail('ERR_PC_APP_LOCK_CHANGED', 'The app runner lock changed during inspection.');
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let position = 0;
    while (position < bytes.length) {
      const count = readSync(descriptor, bytes, position, bytes.length - position, position);
      if (count === 0) throw fail('ERR_PC_APP_LOCK_CHANGED', 'The app runner lock changed during inspection.');
      position += count;
    }
    if (!sameIdentity(opened, fstatSync(descriptor, { bigint: true })) ||
        !sameIdentity(opened, lstatSync(path, { bigint: true }))) {
      throw fail('ERR_PC_APP_LOCK_CHANGED', 'The app runner lock changed during inspection.');
    }
    let owner;
    try { owner = JSON.parse(bytes.toString('utf8')); } catch {
      throw fail('ERR_PC_APP_LOCK_INVALID', 'The app runner lock is corrupt; operator review is required.');
    }
    if (!owner || !Number.isInteger(owner.pid) || owner.pid < 1 || owner.pid > 0x7fffffff ||
        typeof owner.startedAt !== 'string' || !Number.isFinite(Date.parse(owner.startedAt)) ||
        (owner.version !== undefined && owner.version !== 1) ||
        (owner.version === 1 && !/^[a-f0-9-]{36}$/i.test(owner.ownerId ?? ''))) {
      throw fail('ERR_PC_APP_LOCK_INVALID', 'The app runner lock owner is invalid; operator review is required.');
    }
    return { stat: opened, bytes, owner };
  } catch (error) {
    if (error.code?.startsWith('ERR_PC_APP_LOCK_')) throw error;
    if (error.code === 'ENOENT') throw fail('ERR_PC_APP_LOCK_CHANGED', 'The app runner lock changed during inspection.');
    throw fail('ERR_PC_APP_LOCK_IO', 'The app runner lock cannot be inspected safely.');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requireDeadOwner(pid, probePid) {
  try {
    probePid(pid);
  } catch (error) {
    if (error?.code === 'ESRCH') return;
    // EPERM and every other unknown result stay locked. A reused, living PID
    // stays locked even when it does not belong to the original app process.
    throw fail('ERR_PC_APP_LOCK_UNKNOWN_OWNER', 'The app runner owner cannot be verified as stopped.');
  }
  throw fail('ERR_PC_APP_LOCK_BUSY', 'An app runner lock has a living owner.');
}

function create(path, recovered) {
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw error;
    throw fail('ERR_PC_APP_LOCK_IO', 'The app runner lock cannot be created.');
  }
  const bytes = Buffer.from(JSON.stringify({
    version: 1, pid: process.pid, startedAt: new Date().toISOString(), ownerId: randomUUID(),
  }));
  let owned;
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    owned = { stat: fstatSync(descriptor, { bigint: true }), bytes };
  } catch {
    // An interrupted/partial write is deliberately left for operator review.
    closeSync(descriptor);
    throw fail('ERR_PC_APP_LOCK_IO', 'The app runner lock could not be recorded safely.');
  }
  let released = false;
  return {
    path,
    recovered,
    release() {
      if (released) return false;
      released = true;
      try {
        const observed = snapshot(path);
        if (!sameSnapshot(owned, observed) || !sameSnapshot(owned, snapshot(path))) return false;
        // Managed contenders cannot replace this live process's lock. Match
        // both the held descriptor identity and immutable owner bytes anyway.
        unlinkSync(path);
        return true;
      } catch {
        return false;
      } finally {
        closeSync(descriptor);
      }
    },
  };
}

/**
 * Only the fixed runner.lock within the provided app directory is touched.
 *
 * Recovery requires the wrapper's TUAT-PC-Host named mutex for the entire
 * runner lifetime. task.ps1 sets the marker only after acquiring that mutex.
 * Every managed recoverer follows that contract; a direct run never recovers
 * an existing lock without it. Identity checks alone are not a substitute for
 * that cross-process mutex and cannot protect against arbitrary external
 * filesystem mutations after the final check.
 */
export function acquireRunnerLock(stateDirectory, options = {}) {
  // The app API never accepts another service's inherited marker.
  return acquireManagedRunnerLock(stateDirectory, { ...options, recoveryMarker: 'TUAT_PC_APP_MUTEX_HELD' });
}

/** Shared file/owner proof; each service wrapper fixes its own mutex marker. */
export function acquireManagedRunnerLock(stateDirectory, {
  environment = process.env,
  probePid = pid => process.kill(pid, 0),
  recoveryMarker,
} = {}) {
  if (!['TUAT_PC_APP_MUTEX_HELD', 'TUAT_PC_JOBS_MUTEX_HELD'].includes(recoveryMarker)) {
    throw fail('ERR_PC_APP_LOCK_RECOVERY_GUARD_REQUIRED', 'A fixed service mutex contract is required.');
  }
  const path = resolve(appDirectory(stateDirectory), 'runner.lock');
  try { return create(path, false); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const original = snapshot(path);
  requireDeadOwner(original.owner.pid, probePid);
  if (environment[recoveryMarker] !== '1') {
    throw fail('ERR_PC_APP_LOCK_RECOVERY_GUARD_REQUIRED', 'Stale app lock recovery requires the dedicated task mutex.');
  }
  if (!sameSnapshot(original, snapshot(path))) {
    throw fail('ERR_PC_APP_LOCK_CHANGED', 'The app runner lock changed before recovery.');
  }
  requireDeadOwner(original.owner.pid, probePid);
  if (!sameSnapshot(original, snapshot(path))) {
    throw fail('ERR_PC_APP_LOCK_CHANGED', 'The app runner lock changed before recovery.');
  }
  try { unlinkSync(path); } catch {
    throw fail('ERR_PC_APP_LOCK_CHANGED', 'The app runner lock could not be reclaimed safely.');
  }
  try { return create(path, true); } catch (error) {
    if (error.code === 'EEXIST') {
      throw fail('ERR_PC_APP_LOCK_CHANGED', 'Another app runner acquired the lock after recovery.');
    }
    throw error;
  }
}
