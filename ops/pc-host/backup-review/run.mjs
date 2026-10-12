// Synthetic fixture only. No production paths, provider transport or key sources.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, realpathSync, lstatSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateDirectory } from '../release.mjs';
import { encryptBackup, decryptBackup, verifyRecovery } from '../../laptop/backup-backend.mjs';
import { verifyLocalAuth } from './local-auth-http.mjs';

export const PINS = Object.freeze({
  postgres: ['supabase/postgres:17.6.1.136','sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'],
  auth: ['supabase/gotrue:v2.196.0','sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232'],
  storage: ['supabase/storage-api:v1.73.1','sha256:c24fb33cc2fa38d0f9582a30312907fc56da333fb9ba0646833186197e4982f3'],
});
const OWNER='codex-backup-review', DB='tuat_rls_review';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sqlLiteral=value=>`'${String(value).replaceAll("'","''")}'`;
export function assertNoExternalCredentials(env) {
  for (const [name,value] of Object.entries(env)) {
    if (value && /^(?:PGPASSWORD|PGPASSFILE|PGSERVICE|PGSERVICEFILE|DATABASE_URL|SUPABASE_|NEXT_PUBLIC_SUPABASE_|NEXT_PUBLIC_CLOUD_AUTH_|PC_BACKEND_|PC_BACKUP_|PC_APP_|CLOUD_AUTH_|PC_AUTH_SYNC_|CLOUD_AUTH_SYNC_|R2_|AWS_|GOOGLE_|SHEET_SYNC_|CRON_SECRET|NEXT_SERVER_ACTIONS_ENCRYPTION_KEY)/.test(name)) {
      throw Error('Inherited application/database/provider configuration prohibited');
    }
  }
}
export function assertOwned(labels,name,generation,kind='container') {
  if (!/^[a-f0-9]{32}$/.test(generation) || labels?.['tuat.owner']!==OWNER || labels?.['tuat.generation']!==generation
      || !new RegExp(`^${OWNER}-${generation}-(?:source|restore|auth|storage|internal)(?:-data)?$`).test(name)
      || !['container','volume','network'].includes(kind)) throw Error('Owned synthetic resource mismatch');
}
export function verifyPair(dumpEncrypted,recoveryEncrypted,key,instance) {
  const dump=decryptBackup(dumpEncrypted,key);
  if (!dump.subarray(0,5).equals(Buffer.from('PGDMP'))) throw Error('Not a PostgreSQL custom archive');
  return { dump,recovery:verifyRecovery(decryptBackup(recoveryEncrypted,key),dump,instance) };
}
export function reviewEvidencePath(here,generation) {
  if (!/^[a-f0-9]{32}$/.test(generation)) throw Error('Fresh synthetic evidence generation required');
  return resolve(here,'.private',generation,'result.json');
}
export function isUnknownReviewTransportFailure(error) {
  return ['ETIMEDOUT','ENOBUFS'].includes(error?.code) || Boolean(error?.killed || error?.signal);
}
export function assertReviewCleanupComplete(created,names,generation,exists,commandOutcomeUnknown=false) {
  const labels={'tuat.owner':OWNER,'tuat.generation':generation};
  const resources=[...new Set([...created.ephemeral,...created.containers])].map(name=>['container',name]);
  resources.push(...created.volumes.map(name=>['volume',name]));
  if(created.network) resources.push(['network',names.network]);
  for(const [kind,name] of resources) {
    assertOwned(labels,name,generation,kind);
    if(exists(kind,name)) throw Error('Owned synthetic resource remains after cleanup');
  }
  if(commandOutcomeUnknown) throw Error('Terminated WSL/Docker command outcome remains unknown');
}
export async function waitForFreshDatabase(probe,{clock=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=45000}={}) {
  const deadline=clock()+timeoutMs;
  while(clock()<deadline) {
    const beforeProbe=deadline-clock(); if(beforeProbe<=0) break;
    try { if(probe(Math.min(5000,beforeProbe)) && clock()<=deadline) return true; } catch {}
    const remaining=deadline-clock(); if(remaining>0) await sleep(Math.min(500,remaining));
  }
  return false;
}
const fingerprintSql=`SELECT json_build_object('tables',COALESCE(json_agg(row_to_json(t) ORDER BY t.name),'[]')) FROM (
 SELECT n.nspname||'.'||c.relname name,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
  pg_get_userbyid(c.relowner) owner,(SELECT string_agg(a::text,',' ORDER BY a::text COLLATE "C") FROM unnest(COALESCE(c.relacl,acldefault('r',c.relowner))) a) acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','pc_ops') AND c.relkind IN ('r','p')) t;
SELECT json_build_object('policies',COALESCE(json_agg(row_to_json(p) ORDER BY p.schemaname,p.tablename,p.policyname),'[]')) FROM pg_policies p WHERE schemaname IN ('public','auth','storage','pc_ops');
SELECT json_build_object('functions',COALESCE(json_agg(row_to_json(f) ORDER BY f.name,f.arguments),'[]')) FROM (
 SELECT n.nspname||'.'||p.proname name,pg_get_function_identity_arguments(p.oid) arguments,
  pg_get_userbyid(p.proowner) owner,p.prosecdef security_definer,p.proconfig config,
  (SELECT string_agg(a::text,',' ORDER BY a::text COLLATE "C") FROM unnest(COALESCE(p.proacl,acldefault('f',p.proowner))) a) acl,pg_get_functiondef(p.oid) definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage','pc_ops') AND p.prokind IN ('f','p')) f;
SELECT json_build_object('triggers',COALESCE(json_agg(row_to_json(t) ORDER BY t.name),'[]')) FROM (
 SELECT n.nspname||'.'||c.relname||'.'||t.tgname name,pg_get_triggerdef(t.oid) definition,t.tgenabled enabled
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','pc_ops') AND NOT t.tgisinternal) t;
SELECT json_build_object('schemas',COALESCE(json_agg(row_to_json(s) ORDER BY s.name),'[]')) FROM (
 SELECT n.nspname name,pg_get_userbyid(n.nspowner) owner,
 (SELECT string_agg(a::text,',' ORDER BY a::text COLLATE "C") FROM unnest(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a) acl
 FROM pg_namespace n WHERE n.nspname IN ('public','auth','storage','pc_ops')) s;
SELECT json_build_object('columns',COALESCE(json_agg(row_to_json(a) ORDER BY a.name),'[]')) FROM (
 SELECT n.nspname||'.'||c.relname||'.'||a.attname name,format_type(a.atttypid,a.atttypmod) type,
 a.attnotnull not_null,a.attidentity identity,a.attgenerated generated,pg_get_expr(d.adbin,d.adrelid) default_expression,
 (SELECT string_agg(acl::text,',' ORDER BY acl::text COLLATE "C") FROM unnest(a.attacl) acl) acl
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname IN ('public','auth','storage','pc_ops') AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped) a;
SELECT json_build_object('default_acls',COALESCE(json_agg(row_to_json(d) ORDER BY d.owner,d.schema,d.type),'[]')) FROM (
 SELECT pg_get_userbyid(d.defaclrole) owner,COALESCE(n.nspname,'') schema,d.defaclobjtype type,
 (SELECT string_agg(a::text,',' ORDER BY a::text COLLATE "C") FROM unnest(d.defaclacl) a) acl
 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 WHERE d.defaclnamespace=0 OR n.nspname IN ('public','auth','storage','pc_ops')) d;
SELECT json_build_object('constraints',COALESCE(json_agg(row_to_json(c) ORDER BY c.name),'[]')) FROM (
 SELECT n.nspname||'.'||r.relname||'.'||c.conname name,pg_get_constraintdef(c.oid) definition,c.convalidated validated
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
 WHERE n.nspname IN ('public','auth','storage','pc_ops')) c;`;
const rowsSql=`CREATE TEMP TABLE backup_rows(name text,rows bigint,digest text);
DO $$ DECLARE t record; BEGIN FOR t IN
 SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','pc_ops') AND c.relkind='r' ORDER BY n.nspname,c.relname
 LOOP EXECUTE format('INSERT INTO backup_rows SELECT %L,count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E''\\n'' ORDER BY to_jsonb(r)::text COLLATE "C"),'''')) FROM %I.%I r',t.nspname||'.'||t.relname,t.nspname,t.relname); END LOOP; END $$;
SELECT json_agg(row_to_json(r) ORDER BY name) FROM backup_rows r;`;

export async function runReview({localAuth=false}={}) {
  if(typeof localAuth!=='boolean') throw Error('Explicit local Auth review selection required');
  assertNoExternalCredentials(process.env);
  if (process.platform!=='win32') throw Error('This owned cached WSL fixture requires Windows');
  const here=dirname(realpathSync(new URL(import.meta.url))), root=resolve(here,'../../..');
  if (!root.toLowerCase().startsWith('d:\\tuat_tf\\.worktrees\\') || lstatSync(here).isSymbolicLink()) throw Error('Dedicated candidate fixture required');
  const generation=randomUUID().replaceAll('-',''), prefix=`${OWNER}-${generation}`;
  const names={source:`${prefix}-source`,restore:`${prefix}-restore`,auth:`${prefix}-auth`,storage:`${prefix}-storage`,network:`${prefix}-internal`};
  const legacyEvidence=resolve(here,'result.json'), legacyEvidenceBefore=hash(readFileSync(legacyEvidence));
  const evidencePath=reviewEvidencePath(here,generation);
  const privateBase=resolve(here,'.private'); privateDirectory(privateBase);
  const state=resolve(privateBase,generation); privateDirectory(state);
  const proofFiles=['run.mjs','run.test.mjs','fixture.sql','assert-restored.sql','README.md','local-auth-http.mjs','../../local-minimal/verify-local-web-push.sql'];
  const sourceProof=Object.fromEntries(proofFiles.map(name=>[name,hash(readFileSync(resolve(here,name)))]));
  const report={version:2,owner:OWNER,generation,syntheticOnly:true,productionAccess:false,providerCalls:0,r2Requests:0,
    purpose:'current-schema-encrypted-restore-with-sheet-and-creation-receipts',evidencePath,sourceProof,legacyEvidenceSha256:{before:legacyEvidenceBefore},
    network:'internal',publishedPorts:[],success:false,cleanup:false,pins:PINS,migrations:[],tests:{},limits:{memory:'512m',cpus:1,databaseReadinessMs:45000,commandMs:60000}};
  let commandOutcomeUnknown=false;
  const created={containers:[],volumes:[],ephemeral:new Set(),network:false};
  const childEnv={}; for (const name of ['PATH','Path','SystemRoot','WINDIR','USERPROFILE','TEMP','TMP']) if(process.env[name]) childEnv[name]=process.env[name];
  function docker(args,input,timeout=60000) {
    try { return execFileSync('wsl.exe',['-d','Ubuntu','--exec','docker',...args],{input,encoding:'buffer',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024,timeout,windowsHide:true,env:childEnv}); }
    catch(error) { if(isUnknownReviewTransportFailure(error)) commandOutcomeUnknown=true;
      writeFileSync(resolve(state,'failure.private.log'),Buffer.concat([error.stdout??Buffer.alloc(0),error.stderr??Buffer.alloc(0)]),{mode:0o600}); throw Error('Owned synthetic Docker command failed; protected diagnostic retained'); }
  }
  const text=args=>docker(args).toString('utf8').trim();
  const labels=['--label',`tuat.owner=${OWNER}`,'--label',`tuat.generation=${generation}`];
  function ephemeral(name,args) { created.ephemeral.add(name); return docker(['run','--rm','--name',name,...labels,...args]); }
  const sql=(name,statement)=>docker(['exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',DB],Buffer.from(statement)).toString('utf8').trim();
  function containerGuard(name,connected=true) {
    const entry=JSON.parse(text(['inspect',name]))[0];
    assertOwned(entry.Config.Labels,name,generation);
    const networks=Object.keys(entry.NetworkSettings.Networks);
    if(entry.Name!==`/${name}` || !/^[a-f0-9]{64}$/.test(entry.Id) || entry.Image!==PINS.postgres[1]
        || entry.HostConfig.NetworkMode!==names.network || networks.some(network=>network!==names.network)
        || (connected&&networks.length!==1) || Object.keys(entry.HostConfig.PortBindings??{}).length) throw Error('Owned isolation mismatch');
    return entry;
  }
  async function startDatabase(name) {
    const volume=`${name}-data`;
    created.volumes.push(volume); text(['volume','create',...labels,volume]);
    created.containers.push(name);
    docker(['run','-d','--name',name,...labels,'--network',names.network,'--memory','512m','--cpus','1',
      '--mount',`type=volume,src=${volume},dst=/var/lib/postgresql/data`,'-e','POSTGRES_PASSWORD=synthetic-backup-local-only','-e',`POSTGRES_DB=${DB}`,
      PINS.postgres[1],'postgres','-D','/etc/postgresql','-c','listen_addresses=*','-c',`cron.database_name=${DB}`,'-c','cron.launch_active_jobs=off']);
    const ready=await waitForFreshDatabase(timeout=>docker(['exec','-e','PGPASSWORD=synthetic-backup-local-only',name,'psql','-X','-qAt','-h','127.0.0.1','-U','supabase_admin','-d',DB,'-c','SELECT 1'],undefined,timeout).toString('utf8').trim()==='1');
    if(!ready) throw Error('Fresh synthetic database startup exceeded 45 seconds');
    containerGuard(name);
    if(sql(name,'SHOW cron.launch_active_jobs')!=='off') throw Error('Cron must remain disabled');
  }
  try {
    report.stage='cached-images';
    for(const [image,id] of Object.values(PINS)) if(text(['image','inspect',image,'--format','{{.Id}}'])!==id) throw Error('Cached image pin mismatch');
    for(const name of Object.values(names)) if(text(['container','ls','-a','--filter',`name=^/${name}$`,'--format','{{.ID}}'])) throw Error('Fresh owned container name already exists');
    if(text(['network','ls','--filter',`name=^${names.network}$`,'--format','{{.ID}}'])) throw Error('Fresh owned network already exists');
    for(const name of [names.source,names.restore]) if(text(['volume','ls','--filter',`name=^${name}-data$`,'--format','{{.Name}}'])) throw Error('Fresh owned volume already exists');
    created.network=true; text(['network','create','--internal',...labels,names.network]);
    const network=JSON.parse(text(['network','inspect',names.network]))[0];
    assertOwned(network.Labels,network.Name,generation,'network'); if(!network.Internal) throw Error('Internal network required');
    report.stage='bootstrap-source'; await startDatabase(names.source);
    sql(names.source,"ALTER ROLE supabase_auth_admin WITH PASSWORD 'synthetic-backup-local-only'");
    ephemeral(names.auth,['--network',names.network,'--read-only','--tmpfs','/tmp','--entrypoint','auth',
      '-e','GOTRUE_DB_DRIVER=postgres','-e',`GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:synthetic-backup-local-only@${names.source}:5432/${DB}`,
      '-e','GOTRUE_SITE_URL=http://127.0.0.1','-e','API_EXTERNAL_URL=http://127.0.0.1',
      '-e','GOTRUE_JWT_SECRET=synthetic-backup-signing-secret-at-least-32-characters','-e','GOTRUE_EXTERNAL_EMAIL_ENABLED=false','-e','GOTRUE_EXTERNAL_GOOGLE_ENABLED=false',PINS.auth[1],'migrate']);
    report.authMigrations=Number(sql(names.source,'SELECT count(*) FROM auth.schema_migrations'));
    const files=ephemeral(names.storage,['--network','none','--read-only','--entrypoint','ls',PINS.storage[1],'/app/migrations/tenant']).toString('utf8').trim().split(/\r?\n/).sort((a,b)=>parseInt(a)-parseInt(b));
    if(files.length!==67 || files.some(file=>!/^\d+-[A-Za-z0-9_-]+\.sql$/.test(file))) throw Error('Cached Storage migration source mismatch');
    const storageFirst=ephemeral(names.storage,['--network','none','--read-only','--entrypoint','cat',PINS.storage[1],`/app/migrations/tenant/${files[0]}`]);
    const storageRest=ephemeral(names.storage,['--network','none','--read-only','--entrypoint','cat',PINS.storage[1],...files.slice(1).map(file=>`/app/migrations/tenant/${file}`)]);
    const storageSource=Buffer.concat([storageFirst,Buffer.from(';\n'),storageRest]);
    const storagePreamble="SET ROLE supabase_storage_admin; SET search_path=storage,public; SELECT set_config('storage.install_roles','false',false),set_config('storage.multitenant','false',false),set_config('storage.anon_role','anon',false),set_config('storage.authenticated_role','authenticated',false),set_config('storage.service_role','service_role',false),set_config('storage.super_user','supabase_storage_admin',false),set_config('storage.iceberg_default_shard','',false),set_config('storage.iceberg_shards','{}',false),set_config('storage.vector_bucket_provider','s3',false);\n";
    sql(names.source,storagePreamble+storageSource.toString('utf8'));
    report.storageMigrations=files.length; report.storageSourceSha256=hash(storageSource);
    sql(names.source,"CREATE EXTENSION IF NOT EXISTS pg_cron; SELECT cron.schedule('sheet-sync-hourly','0 * * * *','SELECT 1'); SELECT cron.schedule('schedule-import-hourly','5 * * * *','SELECT 1');");
    report.stage='full-app-migrations';
    const migrations=resolve(root,'supabase/migrations');
    const apply=['\\set ON_ERROR_STOP on','SET client_min_messages=warning;'];
    for(const file of readdirSync(migrations).filter(file=>file.endsWith('.sql')).sort()) {
      if(!/^\d+_[A-Za-z0-9_-]+\.sql$/.test(file)) throw Error('Unexpected migration filename');
      const bytes=readFileSync(resolve(migrations,file)); report.migrations.push({name:file,sha256:hash(bytes)});
      apply.push(`\\echo APPLY:${file}`,'BEGIN;',bytes.toString('utf8').replace(/^\uFEFF/,''),'\n;','COMMIT;',`\\echo MIGRATED:${file}`);
    }
    const applied=sql(names.source,apply.join('\n'));
    if(report.migrations.some(migration=>!applied.includes(`MIGRATED:${migration.name}`))) throw Error('Full migration completion evidence missing');
    report.stage='synthetic-fixture';
    sql(names.source,readFileSync(resolve(here,'fixture.sql'),'utf8'));
    if(localAuth) {
      report.stage='native-local-auth-http';
      const start=(name,args)=>{created.ephemeral.delete(name);created.containers.push(name);docker(['run','-d','--name',name,...labels,...args]);};
      report.tests.localAuth=await verifyLocalAuth({docker,sql,names,start,pins:PINS});
      // These exact new API writers must be stopped before dump/fingerprint capture.
      for(const name of [names.auth,names.storage]) {
        docker(['stop','--time','5',name]);
        if(text(['inspect','--format','{{.State.Running}}',name])!=='false') throw Error('Owned local API writer not stopped');
      }
    }
    sql(names.source,"CREATE EXTENSION IF NOT EXISTS pg_cron; SELECT cron.schedule('codex-backup-synthetic','0 0 * * *','SELECT 1'); UPDATE cron.job SET active=false; SELECT vault.create_secret('synthetic-backup-vault-only','codex-backup-test','synthetic fixture');");
    const sourceFingerprint=sql(names.source,fingerprintSql), sourceRows=JSON.parse(sql(names.source,rowsSql));
    const instance=randomUUID(), backupKey=randomBytes(32).toString('hex');
    const dump=docker(['exec',names.source,'pg_dump','-U','supabase_admin','-d',DB,'--format=custom','--schema=public','--schema=auth','--schema=storage','--schema=pc_ops']);
    const recovery={version:1,instanceId:instance,capturedAt:new Date().toISOString(),databaseDumpSha256:hash(dump),
      vault:JSON.parse(sql(names.source,"SELECT coalesce(json_agg(json_build_object('name',name,'description',description,'secret',decrypted_secret) ORDER BY name),'[]') FROM vault.decrypted_secrets")),
      pushEnv:'SYNTHETIC_BACKUP_PUSH=local-fixture-only\n',cron:{installed:true,jobs:JSON.parse(sql(names.source,'SELECT coalesce(json_agg(to_jsonb(j) ORDER BY jobid),\'[]\') FROM cron.job j'))}};
    const encrypted=encryptBackup(dump,backupKey), settings=encryptBackup(Buffer.from(JSON.stringify(recovery)),backupKey);
    writeFileSync(resolve(state,'synthetic.dump.enc'),encrypted,{mode:0o600,flag:'wx'});
    writeFileSync(resolve(state,'synthetic.recovery.json.enc'),settings,{mode:0o600,flag:'wx'});
    report.archive={format:'TUATPC01/AES-256-GCM',dumpBytes:dump.length,encryptedBytes:encrypted.length,sha256:hash(encrypted),recoverySha256:hash(settings),pairedInstance:true};
    let rejected=0;
    for(const [a,b,k,id] of [[encrypted,settings,randomBytes(32).toString('hex'),instance],[encrypted,settings,backupKey,randomUUID()]]) {
      try { verifyPair(a,b,k,id); } catch { rejected++; }
    }
    const damaged=Buffer.from(encrypted); damaged[damaged.length-1]^=1;
    try { verifyPair(damaged,settings,backupKey,instance); } catch { rejected++; }
    const different=encryptBackup(Buffer.concat([dump,Buffer.from('mismatch')]),backupKey);
    try { verifyPair(different,settings,backupKey,instance); } catch { rejected++; }
    if(rejected!==4) throw Error('Wrong key/tamper/instance/dump pairing did not fail closed');
    report.tests.archiveRejections=4;
    const restored=verifyPair(readFileSync(resolve(state,'synthetic.dump.enc')),readFileSync(resolve(state,'synthetic.recovery.json.enc')),backupKey,instance);
    if(!restored.dump.equals(dump)) throw Error('Encrypted local readback mismatch');
    report.stage='fresh-target'; await startDatabase(names.restore);
    // Exact newly created target only: preserve platform roles/extensions, remove
    // baseline auth/storage objects that conflict with the complete custom dump.
    const predata=docker(['exec','-i',names.source,'pg_restore','--section=pre-data','--file','-'],restored.dump).toString('utf8');
    const createsPublic=/^CREATE SCHEMA public;/m.test(predata);
    if(!/^CREATE SCHEMA auth;/m.test(predata) || !/^CREATE SCHEMA storage;/m.test(predata)) throw Error('Complete Auth/Storage schemas absent from archive');
    sql(names.restore,"DO $$ BEGIN IF current_database()<>'tuat_rls_review' OR to_regclass('public.profiles') IS NOT NULL OR EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'Fresh empty owned restore database required'; END IF; END $$; DROP SCHEMA auth CASCADE; DROP SCHEMA storage CASCADE; DROP SCHEMA public CASCADE;"+(createsPublic?'':'CREATE SCHEMA public;')+"CREATE EXTENSION IF NOT EXISTS pg_net; CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;");
    report.publicSchemaCreatedByArchive=createsPublic;
    report.stage='actual-pg-restore';
    docker(['exec','-i',names.restore,'pg_restore','-U','supabase_admin','-d',DB,'--single-transaction','--exit-on-error'],restored.dump);
    // The public schema archive assumes initdb's PUBLIC USAGE default. Removing
    // the fresh baseline schema before a complete CREATE SCHEMA restore loses
    // that default. Restore only this reviewed source-matching schema baseline;
    // it grants no table or function privileges and is not archive coverage.
    const publicUsage="SELECT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname='public' AND pg_get_userbyid(n.nspowner)='pg_database_owner' AND a.grantee=0 AND a.privilege_type='USAGE' AND NOT a.is_grantable)";
    if(sql(names.source,publicUsage)!=='t') throw Error('Reviewed source public schema baseline differs');
    report.tests.archiveContainsInitdbPublicUsage=sql(names.restore,publicUsage)==='t';
    if(!report.tests.archiveContainsInitdbPublicUsage) sql(names.restore,'GRANT USAGE ON SCHEMA public TO PUBLIC;');
    if(sql(names.restore,publicUsage)!=='t') throw Error('Cold public schema baseline absent');
    report.tests.explicitColdPublicSchemaBaseline=true;
    // ALTER ROLE settings are not included by the three-schema pg_dump. This
    // reviewed nonsecret cold prerequisite is applied separately, never inferred
    // from success decrypting/restoring the two-file archive.
    const preRequest="SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator' AND 'pgrst.db_pre_request=public.check_login_access'=ANY(rolconfig))";
    if(sql(names.source,preRequest)!=='t') throw Error('Reviewed source pre-request contract absent');
    report.tests.archiveContainsPreRequestRoleSetting=sql(names.restore,preRequest)==='t';
    if(report.tests.archiveContainsPreRequestRoleSetting) throw Error('Fresh target unexpectedly already has app role config');
    sql(names.restore,"ALTER ROLE authenticator SET pgrst.db_pre_request='public.check_login_access';");
    if(sql(names.restore,preRequest)!=='t') throw Error('Cold target authenticator pre-request contract absent');
    report.tests.explicitColdPreRequestBootstrap=true;
    const targetFingerprint=sql(names.restore,fingerprintSql), targetRows=JSON.parse(sql(names.restore,rowsSql));
    const sourceParts=sourceFingerprint.split('\n').map(line=>JSON.parse(line)),targetParts=targetFingerprint.split('\n').map(line=>JSON.parse(line));
    report.tests.metadataSectionsEqual=Object.fromEntries(sourceParts.map((part,index)=>[Object.keys(part)[0],JSON.stringify(part)===JSON.stringify(targetParts[index])]));
    if(sourceFingerprint!==targetFingerprint || JSON.stringify(sourceRows)!==JSON.stringify(targetRows)) {
      writeFileSync(resolve(state,'metadata-difference.private.json'),JSON.stringify({source:sourceParts,target:targetParts},null,2),{mode:0o600});
      throw Error('Restored rows/UUIDs/schema/RLS/ACL/functions/triggers mismatch');
    }
    report.tests.tablesCompared=sourceRows.length; report.tests.rowsCompared=sourceRows.reduce((total,row)=>total+Number(row.rows),0);
    report.tests.rowsAndUUIDsEqual=true; report.tests.schemaRlsAclFunctionsTriggersEqual=true;
    report.tests.schemaOwnerAclColumnsDefaultAclConstraintsEqual=true;
    report.tests.publicRlsTables=JSON.parse(sourceFingerprint.split('\n')[0]).tables.filter(table=>table.name.startsWith('public.')&&table.rls).length;
    report.schemaFingerprintSha256=hash(Buffer.from(sourceFingerprint));
    report.stage='synthetic-recovery-settings';
    report.tests.vaultSettings=restored.recovery.vault.length; report.tests.cronSettings=restored.recovery.cron.jobs.length;
    const knownJobs=new Set(['sheet-sync-hourly','schedule-import-hourly','codex-backup-synthetic']);
    if(restored.recovery.vault.length!==1 || restored.recovery.cron.jobs.length!==knownJobs.size) throw Error('Unexpected synthetic settings count');
    const vault=restored.recovery.vault[0];
    if(vault.name!=='codex-backup-test' || vault.secret!=='synthetic-backup-vault-only') throw Error('Only explicit synthetic Vault settings may be restored');
    const jobStatements=[];
    for(const job of restored.recovery.cron.jobs) {
      if(!knownJobs.delete(job.jobname) || job.command!=='SELECT 1' || job.active!==false || job.database!==DB || job.username!=='supabase_admin') throw Error('Only explicit synthetic cron settings may be restored');
      jobStatements.push(`SELECT cron.schedule(${sqlLiteral(job.jobname)},${sqlLiteral(job.schedule)},'SELECT 1');`);
    }
    sql(names.restore,`CREATE EXTENSION IF NOT EXISTS pg_cron; BEGIN; SELECT vault.create_secret(${sqlLiteral(vault.secret)},${sqlLiteral(vault.name)},${sqlLiteral(vault.description)}); ${jobStatements.join('\n')} UPDATE cron.job SET active=false; COMMIT;`);
    if(sql(names.restore,"SELECT (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='codex-backup-test')='synthetic-backup-vault-only'")!=='t') throw Error('Synthetic Vault re-encryption mismatch');
    if(restored.recovery.pushEnv!==recovery.pushEnv) throw Error('Synthetic Push configuration mismatch');
    report.tests.vaultRecreated=true; report.tests.pushEnvPreserved=true; report.tests.cronRestoredInactive=true;
    report.stage='real-restored-permission-operations';
    const acceptance=sql(names.restore,(localAuth?"SELECT set_config('tuat.review.native_auth','true',false);\n":"")+readFileSync(resolve(here,'assert-restored.sql'),'utf8'));
    if(!acceptance.includes('PASS:restored-UUID-RLS-allowlist-image-barrier')
      || !acceptance.includes('PASS:restored-sheet-receipts-ACL-unknown-dispatch0-marker-slot')
      || !acceptance.includes('PASS:restored-creation-receipts-4states-ACL-unknown-dispatch0-repair-no-revive')) throw Error('Restored acceptance SQL did not finish');
    if(JSON.stringify(JSON.parse(sql(names.restore,rowsSql)))!==JSON.stringify(sourceRows)) throw Error('Restored acceptance transaction did not roll back');
    report.tests.permittedSaveDeniedSessionRevocationImageBarrier=true; report.tests.assertionsRolledBack=true;
    if(localAuth) {
      report.stage='restored-local-push-and-write-protection';
      const pushAcceptance=sql(names.restore,"SELECT set_config('tuat.review.native_auth','true',false);\n"+readFileSync(resolve(here,'../../local-minimal/verify-local-web-push.sql'),'utf8'));
      if(!pushAcceptance.includes('local Push: opt-in, owner scope, claim once, mirror, backup read-only, restore: PASS')) throw Error('Restored local Push acceptance did not finish');
      if(sql(names.restore,fingerprintSql)!==targetFingerprint || JSON.stringify(JSON.parse(sql(names.restore,rowsSql)))!==JSON.stringify(sourceRows)) throw Error('Local Push acceptance did not roll back');
      report.tests.localPushOptInOwnerNoReplayAndBackupReadOnly=true;
    }
    report.tests.sheetReceipts={restored:5,reservedUnknown:2,confirmedPartial:1,completedApplied:1,completedSuperseded:1,
      realRoleAclRls:true,unknownHeld:true,restoredBeginDispatches:0,markerVersionRetained:true,newerEditRetained:true,sameDayCrossProfileSlotHeld:true};
    report.tests.creationReceipts={restored:4,reservedUnknown:1,resourceKnownSetupUnknown:1,registered:1,resourceKnownSetupConfirmed:1,
      realRoleAclRls:true,restoredBeginDispatches:0,dbOnlyRepair:true,setupUncertaintyHeld:true,duplicateRegistrationDenied:true,
      legitimateEditsRetained:true,deletedCompletedRowNotRevived:true,currentPermissionRevocation:true,preclaimedConflictBlocked:true};
    for(const migration of report.migrations) if(hash(readFileSync(resolve(migrations,migration.name)))!==migration.sha256) throw Error('Migration changed during backup proof');
    for(const name of proofFiles) if(hash(readFileSync(resolve(here,name)))!==sourceProof[name]) throw Error('Review source changed during backup proof');
    report.success=true; report.stage='complete';
  } catch(error) { report.failure=error.message; }
  finally {
    try {
      // Remove only exact resources created by this invocation. A mismatch keeps
      // resources and marks cleanup incomplete instead of broad name cleanup.
      for(const name of created.ephemeral) if(text(['container','ls','-a','--filter',`name=^/${name}$`,'--format','{{.ID}}'])) {
        const entry=JSON.parse(text(['inspect',name]))[0]; assertOwned(entry.Config.Labels,name,generation);
        if(entry.Name!==`/${name}` || !/^[a-f0-9]{64}$/.test(entry.Id) || Object.keys(entry.HostConfig.PortBindings??{}).length
          || (name===names.auth ? entry.Image!==PINS.auth[1] || entry.HostConfig.NetworkMode!==names.network || Object.keys(entry.NetworkSettings.Networks).some(network=>network!==names.network) : entry.Image!==PINS.storage[1] || entry.HostConfig.NetworkMode!=='none')) throw Error('Owned transient isolation mismatch');
        docker(['rm','-f',entry.Id]);
      }
      for(const name of [...created.containers].reverse()) if(text(['container','ls','-a','--filter',`name=^/${name}$`,'--format','{{.ID}}'])) {
        let entry;
        if(localAuth && [names.auth,names.storage].includes(name)) {
          entry=JSON.parse(text(['inspect',name]))[0];assertOwned(entry.Config.Labels,name,generation);
          const sourceId=text(['inspect','--format','{{.Id}}',names.source]);
          const expectedImage=name===names.auth?PINS.auth[1]:'sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c';
          if(entry.Name!==`/${name}` || !/^[a-f0-9]{64}$/.test(entry.Id) || entry.Image!==expectedImage || entry.HostConfig.NetworkMode!==`container:${sourceId}` || Object.keys(entry.HostConfig.PortBindings??{}).length) throw Error('Owned local API cleanup mismatch');
        } else entry=containerGuard(name,false);
        docker(['rm','-f',entry.Id]);
      }
      for(const name of [...created.volumes].reverse()) {
        if(!text(['volume','ls','--filter',`name=^${name}$`,'--format','{{.Name}}'])) continue;
        const entry=JSON.parse(text(['volume','inspect',name]))[0]; assertOwned(entry.Labels,name,generation,'volume');
        if(entry.Name!==name || !entry.Mountpoint.endsWith(`/volumes/${name}/_data`)) throw Error('Owned volume path mismatch');
        docker(['volume','rm',name]);
      }
      if(created.network && text(['network','ls','--filter',`name=^${names.network}$`,'--format','{{.ID}}'])) {
        const entry=JSON.parse(text(['network','inspect',names.network]))[0]; assertOwned(entry.Labels,entry.Name,generation,'network');
        if(!entry.Internal || Object.keys(entry.Containers??{}).length || !/^[a-f0-9]{64}$/.test(entry.Id)) throw Error('Owned network cleanup mismatch');
        docker(['network','rm',entry.Id]);
      }
      assertReviewCleanupComplete(created,names,generation,(kind,name)=>Boolean(text(kind==='container'
        ? ['container','ls','-a','--filter',`name=^/${name}$`,'--format','{{.ID}}']
        : [kind,'ls','--filter',`name=^${name}$`,'--format',kind==='volume'?'{{.Name}}':'{{.ID}}'])),commandOutcomeUnknown);
      // Synthetic archives are unusable after the in-memory key is discarded.
      for(const name of ['synthetic.dump.enc','synthetic.recovery.json.enc']) if(existsSync(resolve(state,name))) rmSync(resolve(state,name));
      report.tests.exactAttemptedResourcesAbsent=true;
      report.cleanup=true;
    } catch(error) { report.cleanupFailure=error.message; report.success=false; }
    report.finishedAt=new Date().toISOString();
    report.commandOutcomeUnknown=commandOutcomeUnknown;
    report.legacyEvidenceSha256.after=hash(readFileSync(legacyEvidence));
    report.legacyEvidenceSha256.unchanged=report.legacyEvidenceSha256.after===legacyEvidenceBefore;
    if(!report.legacyEvidenceSha256.unchanged) { report.success=false; report.failure='Legacy evidence changed during review'; }
    writeFileSync(evidencePath,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  return report;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  if(args.some(arg=>!['--check','--execute'].includes(arg)) || (args.includes('--check')&&args.includes('--execute'))) throw Error('Use --check or --execute');
  if(!args.includes('--execute')) console.log(JSON.stringify({execute:false,resourcePrefix:OWNER+'-',database:DB,network:'internal',publishedPorts:[],productionAccess:false,providerCalls:0,plan:'Generate synthetic current-schema source, encrypt with existing archive format, restore into a distinct fresh owned DB, verify content/RLS/recovery settings, remove exact owned resources.'},null,2));
  else { const report=await runReview(); console.log(JSON.stringify({success:report.success,stage:report.stage,tests:report.tests,cleanup:report.cleanup,evidencePath:report.evidencePath,legacyEvidenceUnchanged:report.legacyEvidenceSha256.unchanged,productionAccess:false,r2Requests:0},null,2)); if(!report.success) process.exitCode=1; }
}
