import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackupConfig,validateCapacity,MIN_MAX_PAIR_BYTES,BACKUP_LIMITS } from './config.mjs';
import { resolve } from 'node:path';

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

const nativeConfig=()=>({version:1,enabled:false,executionMode:'linux',instanceId:'11111111-1111-4111-8111-111111111111',
    stateDirectory:'/private/backup-state',environmentFile:'/private/config/backup.env',dockerExecutable:'/usr/bin/docker',dockerSha256:'a'.repeat(64),
    psqlExecutable:'/usr/bin/psql',pgDumpExecutable:'/usr/bin/pg_dump',pushEnvironmentFile:null,
    target:{containerId:'b'.repeat(64),containerImageId:'sha256:'+ 'c'.repeat(64),containerName:'owned-db',
      databaseName:'tuat_pc_candidate',databaseSystemIdentifier:'1234567890123456789',dataMountSource:'/var/lib/docker/volumes/owned/_data',
      ownerLabel:'owned-runtime',generationLabel:'d'.repeat(32)}});
const pcConfig=()=>{
  const c=nativeConfig();c.profile='pc-private';c.dockerSocket='unix:///run/tuat-local/docker.sock';
  c.localSnapshotReceiptFile=resolve('private-offsite/local-snapshot.json');c.localImageRoot='/var/lib/tuat-local/images';
  delete c.target.ownerLabel;delete c.target.generationLabel;
  Object.assign(c.target,{containerName:'tuat-local-db',dataMountSource:'/var/lib/tuat-local/db',sourceLabel:c.instanceId,roleLabel:'db',configSha256:'e'.repeat(64)});
  return c;
};

test('pc-private binds actual source labels and admits combined snapshots only',()=>{
  const c=pcConfig();assert.doesNotThrow(()=>validateBackupConfig(c));
  const changes=[{...c,profile:'automatic'},{...c,profile:null},{...c,executionMode:'wsl'},{...c,dockerSocket:undefined},
    {...c,dockerSocket:'unix:///var/run/docker.sock'},{...c,localSnapshotReceiptFile:undefined},{...c,localImageRoot:undefined},
    {...c,localImageRoot:'/var/lib/tuat-local/other-images'},{...c,localImageRoot:'/var/lib/tuat-local/images/'},
    {...c,localImageRoot:'/var/lib/tuat-local/../tuat-local/images'}];
  for(const field of ['sourceLabel','roleLabel','configSha256','containerName','dataMountSource'])changes.push({...c,target:{...c.target,[field]:'different'}});
  for(const field of ['ownerLabel','generationLabel','composeProject','composeService'])changes.push({...c,target:{...c.target,[field]:'fake-legacy-label'}});
  changes.push({...c,profile:undefined,target:{...c.target,ownerLabel:'fake',generationLabel:'fake'}});
  for(const changed of changes)assert.throws(()=>validateBackupConfig(changed));
});
test('native Linux configuration requires exact labels and rejects ambiguous WSL dispatch',()=>{
  const config=nativeConfig();
  assert.doesNotThrow(()=>validateBackupConfig(config));
  for(const changed of [{...config,executionMode:'automatic'},{...config,wslExecutable:'/usr/bin/wsl'},
    {...config,target:{...config.target,ownerLabel:''}},{...config,target:{...config.target,generationLabel:''}},
    {...config,target:{...config.target,databaseName:'postgres;DROP DATABASE postgres'}}])assert.throws(()=>validateBackupConfig(changed));
});

test('only native Linux may select one of the two exact local Docker sockets',()=>{
  const native=nativeConfig();
  for(const dockerSocket of [undefined,'unix:///var/run/docker.sock','unix:///run/tuat-local/docker.sock'])
    assert.doesNotThrow(()=>validateBackupConfig(dockerSocket===undefined?native:{...native,dockerSocket}));
  for(const dockerSocket of ['tcp://127.0.0.1:2375','tcp://remote.example.test:2376','unix:///tmp/docker.sock',
    'unix:///run/tuat-local/../docker.sock','unix:///run/tuat-local/docker.sock/','unix://run/tuat-local/docker.sock',
    'npipe:////./pipe/docker_engine','',null])assert.throws(()=>validateBackupConfig({...native,dockerSocket}));
  const wsl={...native,executionMode:'wsl',wslExecutable:process.cwd(),wslSha256:'a'.repeat(64),wslDistribution:'synthetic',wslUser:'synthetic',
    target:{...native.target,databaseName:'postgres',composeProject:'synthetic',composeService:'db'}};
  assert.doesNotThrow(()=>validateBackupConfig(wsl));
  assert.doesNotThrow(()=>validateBackupConfig({...wsl,executionMode:undefined}));
  for(const executionMode of ['wsl',undefined])for(const dockerSocket of ['unix:///run/tuat-local/docker.sock','unix:///var/run/docker.sock'])
    assert.throws(()=>validateBackupConfig({...wsl,executionMode,dockerSocket}));
});
