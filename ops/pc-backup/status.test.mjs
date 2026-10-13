import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backupStatusReady,localSnapshotReady } from './status.mjs';
const fixtures=JSON.parse(readFileSync(new URL('status-vectors.json',import.meta.url),'utf8'));
for(const fixture of fixtures) test(`backup status contract: ${fixture.name}`,()=>{
  assert.equal(backupStatusReady(fixture.status,fixture.identity,fixture.now),fixture.ready);
});

test('local snapshot capture, restore and offsite evidence belong to this startup and remain ordered',()=>{
  const golden=fixtures.find(f=>f.ready),status=structuredClone(golden.status),identity=golden.identity,imageRoot='/synthetic/images';
  const snapshot={format:'tuat-local-db-images-v1',sourceId:identity.instanceId,generation:identity.generation,databaseSystemIdentifier:identity.databaseSystemIdentifier,
    imageRoot,archiveKey:`ops/pc-backend/${identity.instanceId}/backups/${identity.startedAt.replace(/[:.]/g,'-')}.local.tar.enc`,
    archiveSha256:'a'.repeat(64),archiveBytes:128,capturedAt:identity.startedAt,restoreVerifiedAt:'2026-10-11T00:29:30.000Z',offsiteVerifiedAt:'2026-10-11T00:29:59.000Z',independentRecoveryCopyChecked:true};
  Object.assign(status.backup,{localSnapshot:snapshot,key:snapshot.archiveKey,sha256:snapshot.archiveSha256,bytes:snapshot.archiveBytes});
  assert.equal(backupStatusReady(status,identity,golden.now),true);assert.equal(localSnapshotReady(status,identity,imageRoot,golden.now),true);
  for(const change of [{capturedAt:undefined},{capturedAt:'2026-10-11T00:28:59.999Z'},
    {capturedAt:'2026-10-11T00:29:31.000Z'},{restoreVerifiedAt:'2026-10-11T00:29:59.001Z'},
    {offsiteVerifiedAt:'2026-10-11T00:30:00.001Z'},{capturedAt:'invalid'}]) {
    const changed={...status,backup:{...status.backup,localSnapshot:{...snapshot,...change}}};
    assert.equal(localSnapshotReady(changed,identity,imageRoot,golden.now),false);assert.equal(backupStatusReady(changed,identity,golden.now),false);
    assert.equal(backupStatusReady({...golden.status,backup:{...golden.status.backup,localSnapshot:changed.backup.localSnapshot}},identity,golden.now),false);
  }
  const oldIdentity={...identity,startedAt:'2026-10-10T00:00:00.000Z'};
  assert.equal(localSnapshotReady(status,oldIdentity,imageRoot,golden.now+35*60_000),false);
  assert.equal(localSnapshotReady(status,identity,imageRoot,NaN),false);
});
