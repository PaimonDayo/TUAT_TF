import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { encryptBackup } from '../../laptop/backup-backend.mjs';
import { assertNoExternalCredentials,assertOwned,verifyPair } from './run.mjs';
const generation='1'.repeat(32), labels={'tuat.owner':'codex-backup-review','tuat.generation':generation};
test('default check starts no listeners or Docker and generates no keys',()=>{
  const result=spawnSync(process.execPath,[new URL('run.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],{encoding:'utf8'});
  assert.equal(result.status,0); const plan=JSON.parse(result.stdout);
  assert.equal(plan.execute,false); assert.equal(plan.productionAccess,false); assert.deepEqual(plan.publishedPorts,[]);
});
test('inherited provider/database settings reject without exposing values',()=>{
  assert.doesNotThrow(()=>assertNoExternalCredentials({PATH:'safe'}));
  for(const name of ['PGPASSWORD','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_CLOUD_AUTH_URL','R2_SECRET_ACCESS_KEY','GOOGLE_TOKEN_ENCRYPTION_KEY']) {
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
