"""Owner-PC migration rehearsal and baseline-preserving deployment.

Never prints records or connection values. The old cloud remains frozen.
Invoke one explicit phase at a time; protected artifacts retain before/after data.
"""
import hashlib
import importlib.util
import json
import os
import pathlib
import shlex
import subprocess
import sys

os.umask(0o077)
repo = pathlib.Path('/mnt/c/Paimon Dayo/TUAT_TF')
out = pathlib.Path('/opt/tuat-tf-supabase/transfer/competition-v2')
out.mkdir(mode=0o700, exist_ok=True)
spec = importlib.util.spec_from_file_location('transfer', repo / 'ops/laptop/database-transfer.py')
transfer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transfer)
rehearsal = 'competition_v2_rehearsal_20260910'
migrations = [repo / 'supabase/migrations' / name for name in [
    '20260909010000_competition_results_v2.sql',
    '20260910010000_preserve_independent_pb_ub_flags.sql',
]]
original = out.parent / 'cloud-frozen-final-20260909.jsonl'

def run(args, data=None):
    result = subprocess.run(args, input=data, capture_output=True, timeout=240)
    if result.returncode:
        (out / 'last-error.log').write_bytes(result.stderr)
        raise RuntimeError('Operation failed; protected competition-v2/last-error.log retained')
    return result.stdout

def sql(text, db='postgres', cloud=False):
    if cloud:
        env = os.environ.copy()
        for line in (repo / '.contingency/data-dump-command.sh').read_text().splitlines():
            if line.startswith('export PG'):
                name, value = line[7:].split('=', 1)
                env[name] = shlex.split(value)[0]
        if not env.get('PGHOST', '').endswith('.pooler.supabase.com') or env.get('PGPORT') != '5432' or not env.get('PGUSER', '').endswith('.snbgxocgdhqtuywrlqrs'):
            raise RuntimeError('Unexpected cloud target')
        env['PGSSLMODE'] = 'require'
        args = ['docker', 'run', '--rm', '-i']
        for key in ['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE']:
            args += ['--env',key]
        args += ['--entrypoint','psql','supabase/postgres:17.6.1.136','-X','-qAt','-v','ON_ERROR_STOP=1']
        result = subprocess.run(args,input=('SET ROLE postgres;\n'+text).encode(),env=env,capture_output=True,timeout=240)
        if result.returncode:
            (out / 'last-error.log').write_bytes(result.stderr)
            raise RuntimeError('Cloud operation failed; protected error log retained')
        return result.stdout
    return run(['docker','exec','-i','supabase-db','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',db], text.encode())

def snapshot(name, db='postgres', cloud=False):
    path = out / (name+'.jsonl')
    if path.exists(): raise RuntimeError('Preserving existing snapshot: '+name)
    path.write_bytes(sql((repo/'ops/laptop/snapshot.sql').read_text(),db,cloud))
    return transfer.read_snapshot(path)

def canonical(rows):
    return sorted(json.dumps(row,sort_keys=True,ensure_ascii=False) for row in rows)

def equal(a,b):
    if a.keys()!=b.keys(): raise RuntimeError('Table mismatch')
    for table in a:
        for key in ['columns','pk','foreignKeys']:
            if a[table][key]!=b[table][key]: raise RuntimeError('Schema mismatch: '+table)
        if canonical(a[table]['rows'])!=canonical(b[table]['rows']): raise RuntimeError('Row mismatch: '+table)

def migration_sql():
    lines=[]
    for path in migrations:
        version,name=path.stem.split('_',1)
        body=path.read_text(encoding='utf-8-sig')
        lines += [body,
            "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES("+
            ','.join([transfer.literal(version),transfer.literal(name),'ARRAY['+transfer.literal(body)+']'])+
            ");"]
    return '\n'.join(lines)

def assert_legacy_preserved(before, after):
    # Only the explicitly seeded countdown/measure type plus their update timestamps may change.
    for table,old in before.items():
        cols=[c['name'] for c in old['columns']]
        permitted={'"public"."competitions"','"public"."competition_events"'}
        if table in permitted: cols=[c for c in cols if c!='updated_at']
        project=lambda rows:[{c:r[c] for c in cols} for r in rows]
        if canonical(project(old['rows']))!=canonical(project(after[table]['rows'])):
            raise RuntimeError('Unexpected legacy change: '+table)

mode=sys.argv[1]
if mode=='rehearse':
    snapshot('pc-before')
    sql('CREATE DATABASE '+transfer.ident(rehearsal)+';')
    sql('DROP SCHEMA public; CREATE SCHEMA public; CREATE SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;',rehearsal)
    sql((repo/'ops/laptop/freeze-install.sql').read_text(),rehearsal)
    dump=(repo/'.contingency/backend/restore-rehearsal.dump').read_bytes()
    run(['docker','exec','-i','supabase-db','pg_restore','-U','supabase_admin','-d',rehearsal,'--single-transaction','--exit-on-error','--clean','--if-exists'],dump)
    sql('CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);',rehearsal)
    before=snapshot('rehearsal-before',rehearsal)
    sql('BEGIN; SET LOCAL pc_ops.restore=on;\n'+migration_sql()+'\nCOMMIT;',rehearsal)
    after=snapshot('rehearsal-migrated',rehearsal)
    assert_legacy_preserved(before,after)
    rows=after['"public"."pb_records"']['rows']
    print(json.dumps({'rehearsal':rehearsal,'legacyRowsPreserved':True,'pbRecords':len(rows),'tables':len(after)}))
elif mode=='rehearsal-checks':
    sql((repo/'ops/laptop/competition-v2-check.sql').read_text(),rehearsal)
    plan_path=repo/'.contingency/backend/pb-normalization-rehearsal-migrated.sql'
    summary=json.loads(plan_path.with_suffix('.summary.json').read_text())
    if hashlib.sha256(plan_path.read_bytes()).hexdigest()!=summary['sha256']: raise RuntimeError('Normalization plan checksum mismatch')
    sql(plan_path.read_text(),rehearsal)
    snapshot('rehearsal-normalized',rehearsal)
    # The expected preimage changed: a stale plan must now reject without partial updates.
    result=subprocess.run(['docker','exec','-i','supabase-db','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',rehearsal],input=plan_path.read_bytes(),capture_output=True)
    if result.returncode==0 or b'PB snapshot differs' not in result.stderr: raise RuntimeError('Stale normalization plan was not rejected')
    equal(transfer.read_snapshot(out/'rehearsal-normalized.jsonl'),snapshot('rehearsal-after-rejection',rehearsal))
    print(json.dumps({'flagIndependence':True,'constraints':True,'normalizationAppliedInRehearsal':True,'stalePlanRejected':True,'rollbackPreservedData':True}))
elif mode=='access-checks':
    sql((repo/'ops/laptop/competition-v2-access-check.sql').read_text(),rehearsal)
    print(json.dumps({'memberOwnSave':True,'memberOtherEditRejected':True,'memberCatalogWriteRejected':True,'existingAdminEdit':True,'anonymousReadRejected':True,'fixturesRolledBack':True}))
elif mode=='return-rehearsal':
    shadow='competition_v2_return_20260910'
    sql('CREATE DATABASE '+transfer.ident(shadow)+';')
    sql('DROP SCHEMA public; CREATE SCHEMA public; CREATE SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;',shadow)
    sql((repo/'ops/laptop/freeze-install.sql').read_text(),shadow)
    run(['docker','exec','-i','supabase-db','pg_restore','-U','supabase_admin','-d',shadow,'--single-transaction','--exit-on-error','--clean','--if-exists'],(repo/'.contingency/backend/restore-rehearsal.dump').read_bytes())
    sql('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); UPDATE pc_ops.control SET frozen=true;',shadow)
    restored=snapshot('return-restored',shadow)
    baseline=transfer.read_snapshot(original)
    reset,_=transfer.generate(restored,baseline)
    sql(reset,shadow)
    sql('BEGIN; SET LOCAL pc_ops.restore=on;\n'+migration_sql()+'\nCOMMIT;',shadow)
    migrated=snapshot('return-baseline-migrated',shadow)
    latest=transfer.read_snapshot(out/'rehearsal-normalized.jsonl')
    statement,report=transfer.generate(migrated,latest)
    sql(statement,shadow)
    equal(latest,snapshot('return-verified',shadow))
    print(json.dumps({**report,'schemaMigrationAndReturnVerified':True,'allRowsMatch':True}))
elif mode=='cloud-inspect':
    before=snapshot('cloud-before',cloud=True)
    equal(transfer.read_snapshot(original),before)
    frozen=sql('SELECT frozen FROM pc_ops.control WHERE singleton;',cloud=True).decode().strip()
    if frozen!='t': raise RuntimeError('Cloud is not frozen')
    print(json.dumps({'cloudFrozen':True,'originalBaselineMatches':True,'tables':len(before)}))
elif mode=='cloud-migrate':
    if '--owner-approved-cloud-schema' not in sys.argv:
        raise RuntimeError('Cloud updates deferred by owner on September 10; new explicit approval required')
    before=transfer.read_snapshot(out/'cloud-before.jsonl')
    equal(transfer.read_snapshot(original),before)
    (out/'cloud-migration-history.json').write_bytes(sql("SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements)),'[]') FROM supabase_migrations.schema_migrations;",cloud=True))
    validate,_=transfer.generate(before,before)
    plan=validate.rsplit('COMMIT;',1)[0]+migration_sql()+'\nCOMMIT;'
    (out/'cloud-schema-plan.sql').write_text(plan)
    sql(plan,cloud=True)
    after=snapshot('cloud-migrated',cloud=True)
    assert_legacy_preserved(before,after)
    baseline=out/'cloud-migrated.jsonl'
    manifest={'baseline':str(baseline),'sha256':hashlib.sha256(baseline.read_bytes()).hexdigest(),
        'original':str(original),'originalSha256':hashlib.sha256(original.read_bytes()).hexdigest(),
        'migrations':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in migrations}}
    (out.parent/'active-return-baseline.json').write_text(json.dumps(manifest,indent=2))
    print(json.dumps({'cloudMigrated':True,'cloudStillFrozen':True,'legacyRowsPreserved':True,'returnBaseline':str(baseline)}))
elif mode=='pc-migrate':
    if not (out/'rehearsal-normalized.jsonl').exists(): raise RuntimeError('Verify migration and normalization in rehearsal first')
    before=snapshot('pc-immediate-before')
    history=json.loads((out/'cloud-migration-history.json').read_text())
    init="CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); INSERT INTO supabase_migrations.schema_migrations(version,name,statements) SELECT version,name,statements FROM jsonb_populate_recordset(NULL::supabase_migrations.schema_migrations,"+transfer.literal(json.dumps(history))+"::jsonb) ON CONFLICT(version) DO NOTHING;"
    sql('BEGIN; SET LOCAL lock_timeout=\'10s\'; SET LOCAL statement_timeout=\'60s\';\n'+init+migration_sql()+'\nCOMMIT;')
    after=snapshot('pc-migrated')
    assert_legacy_preserved(before,after)
    print(json.dumps({'pcMigrated':True,'legacyRowsPreserved':True,'pbRecords':len(after['"public"."pb_records"']['rows'])}))
elif mode=='pc-normalize':
    plan_path=repo/'.contingency/backend/pb-normalization-pc-migrated.sql'
    summary=json.loads(plan_path.with_suffix('.summary.json').read_text())
    rehearsal_summary=json.loads((repo/'.contingency/backend/pb-normalization-rehearsal-migrated.summary.json').read_text())
    digest=hashlib.sha256(plan_path.read_bytes()).hexdigest()
    if digest!=summary['sha256'] or digest!=rehearsal_summary['sha256']: raise RuntimeError('Plan differs from verified rehearsal; review again')
    snapshot('pc-normalization-before')
    sql(plan_path.read_text())
    after=snapshot('pc-normalized')
    print(json.dumps({'pcNormalizationApplied':True,'changedRows':summary['changedRows'],'eventNames':summary['eventNames'],'recordValues':summary['recordValues'],'legacyTextAndFlagsPreserved':True,'remainingManualReview':summary['manualReview'],'duplicateFlagGroups':summary['duplicateFlagGroups'],'pbRecords':len(after['"public"."pb_records"']['rows'])}))
elif mode=='cloud-state':
    state=sql("SELECT jsonb_build_object('frozen',(SELECT frozen FROM pc_ops.control WHERE singleton),'v2Column',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pb_records' AND column_name='value_cs'),'migrationCount',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20260909010000','20260910010000')));",cloud=True)
    (out/'cloud-final-state.json').write_bytes(state)
    print(state.decode().strip())
else:
    raise RuntimeError('Unknown explicit phase')
