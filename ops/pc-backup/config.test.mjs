import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackupConfig,validateCapacity,MIN_MAX_PAIR_BYTES,BACKUP_LIMITS } from './config.mjs';

const valid=()=>({inventoryLimit:512,maxLocalBytes:10**12,maxRemoteBytes:10**12,minFreeLocalBytes:1024,
  maxPairBytes:MIN_MAX_PAIR_BYTES,maxRequestCount:10_000,maxTransferBytes:10**12});
test('one explicit capacity block has no inferred enabled defaults',()=>{
  assert.doesNotThrow(()=>validateCapacity(valid()));assert.doesNotThrow(()=>validateCapacity(undefined,{required:false}));
  for(const value of [undefined,{}, {...valid(),extra:1},{...valid(),maxPairBytes:MIN_MAX_PAIR_BYTES-1},
    {...valid(),inventoryLimit:BACKUP_LIMITS.inventory+1},{...valid(),maxRemoteBytes:NaN},{...valid(),maxLocalBytes:Number.MAX_SAFE_INTEGER+1}])
    assert.throws(()=>validateCapacity(value));
});
test('pair reservation derives bounded dump plus conservatively escaped recovery and encryption overhead',()=>{
  assert.equal(MIN_MAX_PAIR_BYTES,BACKUP_LIMITS.dumpBytes+BACKUP_LIMITS.recoveryBytes+72);
  assert(BACKUP_LIMITS.recoveryBytes>=6*(2*BACKUP_LIMITS.sqlBytes+BACKUP_LIMITS.pushBytes));
});

test('native Linux configuration requires exact labels and rejects ambiguous WSL dispatch',()=>{
  const config={version:1,enabled:false,executionMode:'linux',instanceId:'11111111-1111-4111-8111-111111111111',
    stateDirectory:'/private/backup-state',environmentFile:'/private/config/backup.env',dockerExecutable:'/usr/bin/docker',dockerSha256:'a'.repeat(64),
    psqlExecutable:'/usr/bin/psql',pgDumpExecutable:'/usr/bin/pg_dump',pushEnvironmentFile:null,
    target:{containerId:'b'.repeat(64),containerImageId:'sha256:'+ 'c'.repeat(64),containerName:'owned-db',
      databaseName:'tuat_pc_candidate',databaseSystemIdentifier:'1234567890123456789',dataMountSource:'/var/lib/docker/volumes/owned/_data',
      ownerLabel:'owned-runtime',generationLabel:'d'.repeat(32)}};
  assert.doesNotThrow(()=>validateBackupConfig(config));
  for(const changed of [{...config,executionMode:'automatic'},{...config,wslExecutable:'/usr/bin/wsl'},
    {...config,target:{...config.target,ownerLabel:''}},{...config,target:{...config.target,generationLabel:''}},
    {...config,target:{...config.target,databaseName:'postgres;DROP DATABASE postgres'}}])assert.throws(()=>validateBackupConfig(changed));
});
