import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireRunnerLock, acquireManagedRunnerLock } from './runner-lock.mjs';

const stoppedPid = 0x7ffffffe;
const startedAt = '2026-10-08T10:00:00.000Z';
const guarded = { environment: { TUAT_PC_APP_MUTEX_HELD: '1' } };
const direct = { environment: {} };
const stopped = () => { throw Object.assign(new Error('Synthetic stopped owner'), { code: 'ESRCH' }); };

test('Windows Jobs recovery cannot borrow the app service mutex', { skip: process.platform !== 'win32' }, t => {
  const { directory, path } = fixture(t), bytes = legacy(path);
  assert.throws(() => acquireManagedRunnerLock(directory, { ...guarded, probePid: stopped, recoveryMarker: 'TUAT_PC_JOBS_MUTEX_HELD' }),
    expectCode('ERR_PC_APP_LOCK_RECOVERY_GUARD_REQUIRED'));
  assert.equal(readFileSync(path,'utf8'),bytes);
  const lock = acquireManagedRunnerLock(directory, { environment: { TUAT_PC_JOBS_MUTEX_HELD: '1' }, probePid: stopped, recoveryMarker: 'TUAT_PC_JOBS_MUTEX_HELD' });
  assert.equal(lock.recovered,true); assert.equal(lock.release(),true);
});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tuat-pc-app-lock-'));
  t.after(() => {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'tuat-pc-app-lock-')) {
      throw Error('Unexpected synthetic app directory');
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, path: join(directory, 'runner.lock') };
}

function legacy(path, pid = stoppedPid) {
  const bytes = JSON.stringify({ pid, startedAt });
  writeFileSync(path, bytes);
  return bytes;
}

function expectCode(code) {
  return error => error?.code === code;
}

test('a direct runner acquires exclusively and releases only its own lock', t => {
  const { directory, path } = fixture(t);
  const lock = acquireRunnerLock(directory, direct);
  assert.equal(lock.path, path);
  assert.equal(lock.recovered, false);
  const owner = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(owner.version, 1);
  assert.equal(owner.pid, process.pid);
  assert.match(owner.ownerId, /^[a-f0-9-]{36}$/i);
  assert.throws(() => acquireRunnerLock(directory, guarded), expectCode('ERR_PC_APP_LOCK_BUSY'));
  assert.equal(lock.release(), true);
  assert.equal(existsSync(path), false);
  assert.equal(lock.release(), false);
});

test('a preexisting live PID is never stolen, including a reused PID', t => {
  const { directory, path } = fixture(t);
  const bytes = legacy(path, process.pid);
  assert.throws(() => acquireRunnerLock(directory, guarded), expectCode('ERR_PC_APP_LOCK_BUSY'));
  assert.equal(readFileSync(path, 'utf8'), bytes);
});

test('a stopped legacy runner is recovered only under the wrapper mutex contract', t => {
  const { directory, path } = fixture(t);
  const bytes = legacy(path);
  assert.throws(() => acquireRunnerLock(directory, { ...direct, probePid: stopped }),
    expectCode('ERR_PC_APP_LOCK_RECOVERY_GUARD_REQUIRED'));
  assert.equal(readFileSync(path, 'utf8'), bytes);
  const lock = acquireRunnerLock(directory, { ...guarded, probePid: stopped });
  assert.equal(lock.recovered, true);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).pid, process.pid);
  assert.equal(lock.release(), true);
});

test('a known exited synthetic child leaves a recoverable PID lock using the real runtime probe', t => {
  const { directory, path } = fixture(t);
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
    windowsHide: true, stdio: 'ignore',
  });
  assert.equal(child.status, 0);
  assert.ok(Number.isInteger(child.pid) && child.pid > 0);
  legacy(path, child.pid);
  const lock = acquireRunnerLock(directory, guarded);
  assert.equal(lock.recovered, true);
  assert.equal(lock.release(), true);
});

test('EPERM and every unknown PID-probe result leave the existing lock untouched', t => {
  const { directory, path } = fixture(t);
  const bytes = legacy(path);
  for (const code of ['EPERM', 'EACCES', 'EINVAL', undefined]) {
    const probePid = () => { throw Object.assign(new Error('Synthetic unknown owner'), { code }); };
    assert.throws(() => acquireRunnerLock(directory, { ...guarded, probePid }),
      expectCode('ERR_PC_APP_LOCK_UNKNOWN_OWNER'));
    assert.equal(readFileSync(path, 'utf8'), bytes);
  }
});

test('corrupt, partial and unsupported owner records stay locked without probing a PID', t => {
  const { directory, path } = fixture(t);
  const invalid = [
    '', '{', 'null', '{}', '{"pid":0}', JSON.stringify({ pid: -1, startedAt }),
    JSON.stringify({ pid: '42', startedAt }), JSON.stringify({ pid: stoppedPid, startedAt: 'invalid' }),
    JSON.stringify({ version: 2, pid: stoppedPid, startedAt }),
    JSON.stringify({ version: 1, pid: stoppedPid, startedAt, ownerId: 'invalid' }),
    'x'.repeat(4097),
  ];
  for (const bytes of invalid) {
    writeFileSync(path, bytes);
    let probed = false;
    assert.throws(() => acquireRunnerLock(directory, { ...guarded, probePid: () => { probed = true; stopped(); } }),
      expectCode('ERR_PC_APP_LOCK_INVALID'));
    assert.equal(probed, false);
    assert.equal(readFileSync(path, 'utf8'), bytes);
  }
});

test('a PID that becomes living between the two probes cannot be recovered', t => {
  const { directory, path } = fixture(t);
  const bytes = legacy(path);
  let probes = 0;
  const probePid = () => { if (++probes === 1) stopped(); };
  assert.throws(() => acquireRunnerLock(directory, { ...guarded, probePid }), expectCode('ERR_PC_APP_LOCK_BUSY'));
  assert.equal(probes, 2);
  assert.equal(readFileSync(path, 'utf8'), bytes);
});

test('replacement or in-place mutation after the first read is preserved', t => {
  const { directory, path } = fixture(t);
  for (const replace of [false, true]) {
    legacy(path);
    const replacement = JSON.stringify({ pid: process.pid, startedAt });
    const probePid = () => {
      if (replace) unlinkSync(path);
      writeFileSync(path, replacement);
      stopped();
    };
    assert.throws(() => acquireRunnerLock(directory, { ...guarded, probePid }), expectCode('ERR_PC_APP_LOCK_CHANGED'));
    assert.equal(readFileSync(path, 'utf8'), replacement);
  }
});

test('a mutation during the final PID probe is caught before stale deletion', t => {
  const { directory, path } = fixture(t);
  legacy(path);
  const replacement = JSON.stringify({ pid: process.pid, startedAt });
  let probes = 0;
  const probePid = () => {
    if (++probes === 2) writeFileSync(path, replacement);
    stopped();
  };
  assert.throws(() => acquireRunnerLock(directory, { ...guarded, probePid }), expectCode('ERR_PC_APP_LOCK_CHANGED'));
  assert.equal(readFileSync(path, 'utf8'), replacement);
});

test('managed direct contenders cannot replace a stale lock while the wrapper recovers it', t => {
  const { directory, path } = fixture(t);
  const bytes = legacy(path);
  let contenders = 0;
  const probePid = () => {
    contenders++;
    assert.throws(() => acquireRunnerLock(directory, { ...direct, probePid: stopped }),
      expectCode('ERR_PC_APP_LOCK_RECOVERY_GUARD_REQUIRED'));
    assert.equal(readFileSync(path, 'utf8'), bytes);
    stopped();
  };
  const recovered = acquireRunnerLock(directory, { ...guarded, probePid });
  assert.equal(contenders, 2);
  assert.throws(() => acquireRunnerLock(directory, direct), expectCode('ERR_PC_APP_LOCK_BUSY'));
  assert.equal(recovered.release(), true);
});

test('release never deletes a concurrent replacement or modified owner record', t => {
  const { directory, path } = fixture(t);
  for (const replace of [false, true]) {
    const lock = acquireRunnerLock(directory, direct);
    if (replace) unlinkSync(path);
    const replacement = JSON.stringify({ pid: process.pid, startedAt });
    writeFileSync(path, replacement);
    assert.equal(lock.release(), false);
    assert.equal(readFileSync(path, 'utf8'), replacement);
    unlinkSync(path);
  }
});

test('release tolerates an already absent lock without affecting other app state', t => {
  const { directory, path } = fixture(t);
  const unrelated = join(directory, 'status.json');
  writeFileSync(unrelated, '{"synthetic":"retained"}');
  const lock = acquireRunnerLock(directory, direct);
  unlinkSync(path);
  assert.equal(lock.release(), false);
  assert.equal(readFileSync(unrelated, 'utf8'), '{"synthetic":"retained"}');
});

test('only an existing absolute app directory and a regular fixed lock are accepted', t => {
  const { directory, path } = fixture(t);
  assert.throws(() => acquireRunnerLock('relative-app-state', direct), expectCode('ERR_PC_APP_LOCK_INVALID_DIRECTORY'));
  assert.throws(() => acquireRunnerLock(join(directory, 'missing'), direct), expectCode('ERR_PC_APP_LOCK_INVALID_DIRECTORY'));
  mkdirSync(path);
  assert.throws(() => acquireRunnerLock(directory, guarded), expectCode('ERR_PC_APP_LOCK_INVALID'));
  assert.equal(existsSync(path), true);
});

test('a redirected app directory is rejected before any lock can reach its target', t => {
  const { directory } = fixture(t);
  const target = join(directory, 'target');
  const redirected = join(directory, 'redirected');
  mkdirSync(target);
  symlinkSync(target, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => acquireRunnerLock(redirected, direct), expectCode('ERR_PC_APP_LOCK_INVALID_DIRECTORY'));
  assert.equal(existsSync(join(target, 'runner.lock')), false);
});
