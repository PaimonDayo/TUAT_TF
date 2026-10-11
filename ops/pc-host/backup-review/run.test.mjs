import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { encryptBackup } from '../../laptop/backup-backend.mjs';
import { resolve } from 'node:path';
import { assertNoExternalCredentials,assertOwned,verifyPair,reviewEvidencePath,assertReviewCleanupComplete,waitForFreshDatabase,isUnknownReviewTransportFailure } from './run.mjs';
const generation='1'.repeat(32), labels={'tuat.owner':'codex-backup-review','tuat.generation':generation};
test('default check starts no listeners or Docker and generates no keys',()=>{
  const result=spawnSync(process.execPath,[new URL('run.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],{encoding:'utf8'});
  assert.equal(result.status,0); const plan=JSON.parse(result.stdout);
  assert.equal(plan.execute,false); assert.equal(plan.productionAccess,false); assert.deepEqual(plan.publishedPorts,[]);
});
test('inherited provider/database settings reject without exposing values',()=>{
  assert.doesNotThrow(()=>assertNoExternalCredentials({PATH:'safe'}));
  for(const name of ['PGPASSWORD','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_CLOUD_AUTH_URL','R2_SECRET_ACCESS_KEY','GOOGLE_TOKEN_ENCRYPTION_KEY','PC_BACKUP_CONFIG_FILE','PC_APP_BACKUP_STATUS_PATH']) {
    assert.throws(()=>assertNoExternalCredentials({[name]:'do-not-print'}),error=>!error.message.includes('do-not-print'));
  }
});
test('resource guard rejects existing review/production names and mismatched labels',()=>{
  assert.doesNotThrow(()=>assertOwned(labels,`codex-backup-review-${generation}-source`,generation));
  for(const name of ['supabase-db',`codex-auth-dbreview-${generation}`,`tuat-review-${generation}`]) assert.throws(()=>assertOwned(labels,name,generation));
  assert.throws(()=>assertOwned({...labels,'tuat.owner':'other'},`codex-backup-review-${generation}-restore`,generation));
});
test('existing authenticated archive format binds synthetic dump and recovery identity',()=>{
  const key=randomBytes(32).toString('hex'),instance='11111111-1111-4111-8111-111111111111',dump=Buffer.from('PGDMP test fixture');
  const recovery={version:1,instanceId:instance,databaseDumpSha256:createHash('sha256').update(dump).digest('hex'),vault:[],pushEnv:null,cron:{installed:false,jobs:[]}};
  const encrypted=encryptBackup(dump,key),settings=encryptBackup(Buffer.from(JSON.stringify(recovery)),key);
  assert.deepEqual(verifyPair(encrypted,settings,key,instance).dump,dump);
  assert.throws(()=>verifyPair(encrypted,settings,randomBytes(32).toString('hex'),instance));
  assert.throws(()=>verifyPair(encrypted,settings,key,'different-instance'));
  encrypted[encrypted.length-1]^=1;
  assert.throws(()=>verifyPair(encrypted,settings,key,instance));
});
test('fresh evidence path preserves the existing result and rejects reused non-generation names',()=>{
  const here=resolve('synthetic-evidence-test');
  const current=reviewEvidencePath(here,generation), next=reviewEvidencePath(here,'2'.repeat(32));
  assert.equal(current,resolve(here,'.private',generation,'result.json'));
  assert.notEqual(current,resolve(here,'result.json')); assert.notEqual(current,next);
  for(const value of ['../result','result.json','',generation+'x']) assert.throws(()=>reviewEvidencePath(here,value));
});
test('cleanup reconciles every attempted resource and rejects one leftover or foreign name',()=>{
  const prefix=`codex-backup-review-${generation}`;
  const names={network:prefix+'-internal'};
  const created={ephemeral:new Set([prefix+'-auth',prefix+'-storage']),containers:[prefix+'-source',prefix+'-restore'],
    volumes:[prefix+'-source-data',prefix+'-restore-data'],network:true};
  const seen=[];
  assert.doesNotThrow(()=>assertReviewCleanupComplete(created,names,generation,(kind,name)=>{seen.push([kind,name]);return false;}));
  assert.equal(seen.length,7); assert.deepEqual(seen.at(-1),['network',names.network]);
  // A mutation with an unknown response can leave only its attempted network.
  assert.throws(()=>assertReviewCleanupComplete(created,names,generation,(kind)=>kind==='network'));
  assert.throws(()=>assertReviewCleanupComplete({...created,containers:['supabase-db']},names,generation,()=>false));
});
test('timeout, bounded-output termination, or killed transport never establishes completed cleanup',()=>{
  const created={ephemeral:new Set(),containers:[],volumes:[],network:true};
  const names={network:`codex-backup-review-${generation}-internal`};
  for(const error of [{code:'ETIMEDOUT'},{code:'ENOBUFS'},{signal:'SIGTERM'},{killed:true}]) {
    assert.equal(isUnknownReviewTransportFailure(error),true);
    assert.throws(()=>assertReviewCleanupComplete(created,names,generation,()=>false,isUnknownReviewTransportFailure(error)));
  }
  for(const error of [{code:'ENOENT'},{status:1},null]) {
    assert.equal(isUnknownReviewTransportFailure(error),false);
    assert.doesNotThrow(()=>assertReviewCleanupComplete(created,names,generation,()=>false,isUnknownReviewTransportFailure(error)));
  }
});
test('database readiness bounds failed probes by elapsed time rather than retry count',async()=>{
  let now=0;const budgets=[],sleeps=[];
  const ready=await waitForFreshDatabase(timeout=>{budgets.push(timeout);now+=timeout;throw Error('synthetic timeout');},
    {clock:()=>now,sleep:async ms=>{sleeps.push(ms);now+=ms;},timeoutMs:12000});
  assert.equal(ready,false);assert.equal(now,12000);assert.deepEqual(budgets,[5000,5000,1000]);assert.deepEqual(sleeps,[500,500]);
});
test('readiness permits recovery within deadline and rejects success after deadline',async()=>{
  let now=0,attempts=0;
  assert.equal(await waitForFreshDatabase(()=>++attempts===3,{clock:()=>now,sleep:async ms=>{now+=ms;},timeoutMs:2000}),true);
  assert.equal(attempts,3);assert.equal(now,1000);
  now=0;
  assert.equal(await waitForFreshDatabase(()=>{now=2001;return true;},{clock:()=>now,sleep:async()=>{},timeoutMs:2000}),false);
});
