import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { backupChildEnvironment, backupRuntimeRecord, validateBackupOwnerConfig, BACKUP_CHILD_ENV } from './backup-owner.mjs';

const now = Date.parse('2026-10-11T04:00:00.000Z');
const config = { releaseDirectory: resolve('synthetic-release'), backupConfigFile: resolve('synthetic-private/config.json'),
  expectedBackupInstanceId: '00000000-0000-4000-8000-000000000001', expectedBackupDatabaseSystemIdentifier: '1234567890123456789' };
const supervisor = { identity: { instanceId: config.expectedBackupInstanceId, generation: '00000000-0000-4000-8000-000000000002', startedAt: new Date(now).toISOString() },
  statusPath: resolve('synthetic-private/backup-lifecycle.json'), stop() {} };

test('host injects the newly owned generation and pins the independently configured database', () => {
  validateBackupOwnerConfig(config, {});
  const env = backupChildEnvironment(config, supervisor, now);
  assert.deepEqual(Object.keys(env), BACKUP_CHILD_ENV);
  assert.equal(env.PC_APP_BACKUP_GENERATION, supervisor.identity.generation);
  assert.equal(env.PC_APP_BACKUP_DATABASE_SYSTEM_IDENTIFIER, config.expectedBackupDatabaseSystemIdentifier);
  assert.deepEqual(backupRuntimeRecord(config, supervisor, now).identity, { ...supervisor.identity, databaseSystemIdentifier: config.expectedBackupDatabaseSystemIdentifier, databaseName:'postgres' });
});
test('native database name is pinned by the owning host rather than the app environment',()=>{
  const native={...config,expectedBackupDatabaseName:'tuat_pc_candidate'};
  assert.throws(()=>backupChildEnvironment(native,supervisor,now));
  const env=backupChildEnvironment(native,{...supervisor,databaseName:'tuat_pc_candidate'},now);
  assert.equal(env.PC_APP_BACKUP_DATABASE_NAME,'tuat_pc_candidate');
  assert.throws(()=>validateBackupOwnerConfig(native,{PC_APP_BACKUP_DATABASE_NAME:'other'}));
});

test('static environment cannot supply a previous generation, timestamp, or status path', () => {
  for (const name of BACKUP_CHILD_ENV) assert.throws(() => validateBackupOwnerConfig(config, { [name]: 'previous-run' }));
  for (const changes of [{ backupConfigFile: 'relative.json' }, { expectedBackupInstanceId: 'other' }, { expectedBackupDatabaseSystemIdentifier: '' }]) {
    assert.throws(() => validateBackupOwnerConfig({ ...config, ...changes }, {}));
  }
});

test('a supervisor belonging to another namespace, a future start, or a release-contained state is refused', () => {
  for (const identity of [{ ...supervisor.identity, instanceId: '00000000-0000-4000-8000-000000000003' },
    { ...supervisor.identity, generation: 'old' }, { ...supervisor.identity, startedAt: new Date(now + 1).toISOString() },
    { ...supervisor.identity, startedAt: '2026-10-11T04:00:00Z' }]) {
    assert.throws(() => backupChildEnvironment(config, { ...supervisor, identity }, now));
  }
  for (const statusPath of ['relative.json', config.releaseDirectory, resolve(config.releaseDirectory, 'state/status.json')]) {
    assert.throws(() => backupChildEnvironment(config, { ...supervisor, statusPath }, now));
  }
  assert.throws(() => backupChildEnvironment(config, { ...supervisor, stop: undefined }, now));
});
