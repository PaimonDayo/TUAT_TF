"""Real non-superuser PostgreSQL fixture; two new labelled network-none clusters.

python3 -B cloud-source-freeze.test.py --image sha256:<cached-image-id>
No image pull, host listener, source DB, production credentials or real rows.
Only exact containers created and re-verified by this invocation are removed.
"""
import argparse
import json
import pathlib
import re
import subprocess
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--socket', default='unix:///var/run/docker.sock',
                        choices=['unix:///var/run/docker.sock', 'unix:///run/tuat-local/docker.sock'])
    args = parser.parse_args()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', args.image):
        parser.error('An already-cached immutable image ID is required')
    base = pathlib.Path(__file__).resolve().parent
    install = (base/'cloud-source-freeze.sql').read_text(encoding='utf-8')
    release = (base/'cloud-source-freeze-release.sql').read_text(encoding='utf-8')
    generation = str(uuid.uuid4())
    owner = 'codex-cloud-freeze-tests'
    database = 'tuat_cloud_freeze_test'
    actor = 'cloud_freeze_operator'
    created, checks = {}, []

    def docker(argv, content=None, fail=False, timeout=60):
        result = subprocess.run(['docker', '--host', args.socket, *argv], input=content,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        if result.returncode and not fail:
            raise RuntimeError('Synthetic Docker/SQL failed: '+result.stderr.decode(errors='replace')[-2500:])
        return result

    def guard(name):
        value = json.loads(docker(['inspect', name]).stdout)[0]
        if (name not in created or created[name] not in (None, value['Id']) or value['Name'] != '/'+name
                or value['Image'] != args.image or value['Config']['Labels'].get('tuat.owner') != owner
                or value['Config']['Labels'].get('tuat.generation') != generation
                or value['HostConfig']['NetworkMode'] != 'none' or value['HostConfig'].get('PortBindings')
                or value['HostConfig'].get('Binds') or any(m['Type'] != 'tmpfs' for m in value['Mounts'])):
            raise RuntimeError('Synthetic cloud fixture identity mismatch')
        created[name] = value['Id']

    def sql(name, statement, fail=False, role=actor):
        guard(name)
        prefix = 'SET ROLE '+role+';\n' if role else ''
        result = docker(['exec', '-i', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                         '-v', 'VERBOSITY=verbose', '-U', 'supabase_admin', '-d', database, '-f', '-'],
                        (prefix+statement).encode(), fail=fail)
        if fail:
            if result.returncode == 0:
                raise AssertionError('Expected synthetic SQL refusal')
            return result.stderr.decode(errors='replace')
        return result.stdout.decode().strip()

    def start(suffix):
        name = 'tuat-cloud-freeze-test-'+generation+'-'+suffix
        if docker(['container', 'ls', '-a', '--filter', 'name=^/'+name+'$', '--format', '{{.ID}}']).stdout.strip():
            raise RuntimeError('Synthetic name already exists')
        created[name] = None
        result = docker(['run', '-d', '--pull', 'never', '--name', name,
                         '--label', 'tuat.owner='+owner, '--label', 'tuat.generation='+generation,
                         '--network', 'none', '--memory', '768m', '--cpus', '1',
                         '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=32m',
                         '-e', 'POSTGRES_PASSWORD=synthetic-cloud-freeze-only', '-e', 'POSTGRES_DB='+database,
                         args.image, 'postgres', '-D', '/etc/postgresql', '-c', 'listen_addresses=127.0.0.1',
                         '-c', 'cron.database_name='+database, '-c', 'cron.launch_active_jobs=off',
                         '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic'])
        value = result.stdout.decode().strip()
        if not re.fullmatch(r'[a-f0-9]{64}', value):
            raise RuntimeError('Synthetic start outcome unknown')
        created[name] = value
        for _ in range(160):
            guard(name)
            pid1 = docker(['exec', name, 'cat', '/proc/1/comm'], fail=True)
            result = docker(['exec', name, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database,
                             '-c', 'SELECT 1'], fail=True)
            if pid1.stdout.strip() in (b'postgres', b'.postgres-wrapp') and result.returncode == 0 and result.stdout.strip() == b'1':
                break
            time.sleep(.25)
        else:
            raise RuntimeError('Synthetic cloud PostgreSQL did not start')
        docker(['exec', name, 'dropdb', '--force', '-U', 'supabase_admin', database])
        docker(['exec', name, 'createdb', '-U', 'supabase_admin', '--template=template0', database])
        sql(name, """DROP SCHEMA public;
          CREATE ROLE cloud_freeze_operator LOGIN NOSUPERUSER NOINHERIT;
          CREATE ROLE cloud_managed_owner NOLOGIN NOSUPERUSER;
          GRANT EXECUTE ON FUNCTION pg_control_system() TO cloud_freeze_operator;""", role=None)
        return name

    inventory = """SELECT md5(coalesce(string_agg(format('%I.%I:%s',n.nspname,c.relname,c.relkind),E'\\n'
      ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"),'')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p');"""

    def sysid(name):
        value = sql(name, 'SELECT system_identifier::text FROM pg_control_system();')
        if value in ('7686488340612984867', '7642734024280108049', '7696014892776206346'):
            raise RuntimeError('Production/candidate SYS is forbidden in a test fixture')
        return value

    def settings(name, mode=None, source=None, expected=None, catalog=None):
        values = {'expected_system_identifier': expected or sysid(name), 'generation': generation}
        if mode:
            values.update(expected_source_system_identifier=source or sysid(name), release_mode=mode)
        else:
            values.update(forbidden_system_identifier='1000000000000000000', target_kind='cloud-auth',
                          expected_inventory_md5=catalog or sql(name, inventory))
        return '\n'.join("SET tuat.cloud_final_freeze."+key+"='"+value+"';" for key, value in values.items())+'\n'

    def baseline(name):
        return sql(name, """SELECT jsonb_build_object(
          'triggers',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname)
            FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE NOT t.tgisinternal AND n.nspname IN ('public','storage','auth')),
          'tables',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,pg_get_userbyid(c.relowner),c.relacl::text) ORDER BY n.nspname,c.relname)
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p')),
          'schemas',(SELECT jsonb_agg(jsonb_build_array(nspname,pg_get_userbyid(nspowner),nspacl::text) ORDER BY nspname)
            FROM pg_namespace WHERE nspname IN ('public','storage','auth','pc_ops')),
          'data',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.members t));""")

    try:
        first = start('a')
        sql(first, """CREATE SCHEMA public AUTHORIZATION cloud_freeze_operator;
          CREATE SCHEMA auth AUTHORIZATION cloud_managed_owner;
          CREATE SCHEMA storage AUTHORIZATION cloud_managed_owner;
          CREATE SCHEMA pc_ops AUTHORIZATION cloud_freeze_operator;
          CREATE TABLE pc_ops.observations(n integer); INSERT INTO pc_ops.observations VALUES(0);
          ALTER TABLE pc_ops.observations OWNER TO cloud_freeze_operator;
          CREATE TABLE public.members(id integer PRIMARY KEY,value text); INSERT INTO public.members VALUES(1,'before');
          CREATE TABLE public.partitioned(id integer) PARTITION BY RANGE(id);
          CREATE TABLE public.partition_child PARTITION OF public.partitioned FOR VALUES FROM(0) TO(10);
          ALTER TABLE public.members OWNER TO cloud_freeze_operator;
          ALTER TABLE public.partitioned OWNER TO cloud_freeze_operator;
          ALTER TABLE public.partition_child OWNER TO cloud_freeze_operator;
          CREATE TABLE storage.objects(id integer);
          CREATE TABLE storage.buckets_vectors(id integer); CREATE TABLE storage.vector_indexes(id integer);
          CREATE TABLE storage.migrations(id integer); INSERT INTO storage.migrations VALUES(1);
          CREATE TABLE auth.schema_migrations(id integer); INSERT INTO auth.schema_migrations VALUES(1),(2);
          CREATE TABLE auth.users(id integer); INSERT INTO auth.users VALUES(1);
          CREATE TABLE auth.identities(id integer); CREATE TABLE auth.sessions(id integer);
          DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['mfa_factors','mfa_challenges','mfa_amr_claims','flow_state','refresh_tokens','audit_log_entries','sso_providers'] LOOP
            EXECUTE format('CREATE TABLE auth.%I(id integer)',n); END LOOP;
            FOR i IN 1..16 LOOP EXECUTE format('CREATE TABLE auth.fixture_%s(id integer)',i); END LOOP; END $$;
          DO $$ DECLARE t record; BEGIN FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname IN ('auth','storage') AND c.relkind='r' LOOP EXECUTE format('ALTER TABLE %I.%I OWNER TO cloud_managed_owner',t.nspname,t.relname); END LOOP; END $$;
          GRANT USAGE ON SCHEMA auth,storage TO cloud_freeze_operator;
          GRANT SELECT ON ALL TABLES IN SCHEMA auth,storage TO cloud_freeze_operator;
          DO $$ DECLARE t record; BEGIN FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname IN ('auth','storage') AND c.relkind='r' AND n.nspname||'.'||c.relname<>ALL(ARRAY['auth.schema_migrations','storage.migrations','storage.buckets_vectors','storage.vector_indexes'])
            LOOP EXECUTE format('GRANT UPDATE,TRIGGER ON %I.%I TO cloud_freeze_operator',t.nspname,t.relname); END LOOP; END $$;
          GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
          GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA public,auth,storage TO anon,authenticated,service_role;""", role=None)
        sql(first, """CREATE FUNCTION pc_ops.observe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE pc_ops.observations SET n=n+1; RETURN NULL; END $$;
          CREATE TRIGGER previous_observer AFTER INSERT ON public.members FOR EACH STATEMENT EXECUTE FUNCTION pc_ops.observe();""")
        assert sql(first, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relkind='r';") == '27'
        assert sql(first, 'SELECT rolsuper FROM pg_roles WHERE rolname=current_user;') == 'f'
        before = baseline(first)
        assert 'identity/settings mismatch' in sql(first, settings(first, expected='1000000000000000001')+install, fail=True)
        assert sql(first, "SELECT to_regclass('pc_ops.cloud_final_freeze_state') IS NULL;") == 't'
        sql(first, 'INSERT INTO storage.vector_indexes VALUES(1);', role=None)
        assert 'vector table is in use' in sql(first, settings(first)+install, fail=True)
        sql(first, 'DELETE FROM storage.vector_indexes;', role=None)
        sql(first, 'REVOKE TRIGGER ON auth.users FROM cloud_freeze_operator;', role=None)
        assert 'guarded table privilege missing' in sql(first, settings(first)+install, fail=True)
        sql(first, 'GRANT TRIGGER ON auth.users TO cloud_freeze_operator;', role=None)
        old_catalog = sql(first, inventory)
        sql(first, 'CREATE TABLE public.new_table(id integer); GRANT UPDATE,TRIGGER ON public.new_table TO cloud_freeze_operator;', role=None)
        assert 'full table inventory changed' in sql(first, settings(first, catalog=old_catalog)+install, fail=True)
        sql(first, 'DROP TABLE public.new_table;', role=None)
        checks.append('wrong-sys-active-vectors-lost-privilege-new-table-all-refused')
        dry = install.removesuffix('COMMIT;\n')+'ROLLBACK;\n'
        sql(first, settings(first)+dry)
        assert sql(first, "SELECT to_regclass('pc_ops.cloud_final_freeze_state') IS NULL;") == 't'
        assert baseline(first) == before
        checks.append('nonowner-trigger-grant-dryrun-rolls-back-everything')
        sql(first, settings(first)+install)
        assert sql(first, "SELECT jsonb_array_length(full_table_catalog)||':'||jsonb_array_length(guarded_table_catalog)||':'||jsonb_array_length(excluded_table_catalog) FROM pc_ops.cloud_final_freeze_state;") == '34:30:4'
        assert sql(first, "SELECT string_agg(tgenabled::text||':'||n,E',' ORDER BY tgenabled) FROM (SELECT tgenabled,count(*) n FROM pg_trigger WHERE tgname='pc_cloud_final_source_freeze' GROUP BY tgenabled) t;") == 'A:3,O:27'
        assert 'already exists' in sql(first, settings(first)+install, fail=True)
        for role in ('anon','authenticated','service_role',actor):
            for mutation in ('UPDATE public.members SET value=value WHERE false','UPDATE auth.users SET id=id WHERE false',
                             'UPDATE auth.identities SET id=id WHERE false','UPDATE auth.mfa_factors SET id=id WHERE false',
                             'UPDATE storage.objects SET id=id WHERE false','UPDATE public.partition_child SET id=id WHERE false'):
                assert '55000' in sql(first, "SET request.headers='{\"x-tuat-mirror\":\"1\"}'; SET pc_ops.restore='on'; "+mutation+';', role=role, fail=True)
        for mutation in ('INSERT INTO public.members VALUES(2,\'blocked\')','DELETE FROM public.members WHERE false','TRUNCATE public.members'):
            assert '55000' in sql(first, mutation+';', role='service_role', fail=True)
        sql(first, 'SET session_replication_role=replica; UPDATE auth.users SET id=id WHERE false;', role=None)
        assert '55000' in sql(first, 'SET session_replication_role=replica; DELETE FROM public.members WHERE false;', role=None, fail=True)
        sql(first, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT count(*) FROM auth.users; SELECT count(*) FROM auth.schema_migrations; ROLLBACK;')
        assert 'must be owner' in sql(first, 'DROP TRIGGER pc_cloud_final_source_freeze ON auth.users;', fail=True)
        checks.append('all-26-guarded-auth-origin-writes-rejected-a-o-limit-and-drop-ownership-demonstrated')
        assert 'does not match installed full fence' in sql(first, settings(first, mode='clone-restore')+release, fail=True)
        sql(first, 'ALTER TABLE public.members DISABLE TRIGGER previous_observer;')
        assert 'Original cloud triggers' in sql(first, settings(first, mode='source-rollback')+release, fail=True)
        sql(first, 'ALTER TABLE public.members ENABLE TRIGGER previous_observer;')
        sql(first, 'GRANT REFERENCES ON auth.users TO anon;', role=None)
        assert 'full table/ACL/A-O guard coverage changed' in sql(first, settings(first, mode='source-rollback')+release, fail=True)
        sql(first, 'REVOKE REFERENCES ON auth.users FROM anon;', role=None)
        sql(first, 'CREATE TABLE pc_ops.unrelated(id integer); CREATE TRIGGER other_guard BEFORE UPDATE ON pc_ops.unrelated FOR EACH STATEMENT EXECUTE FUNCTION pc_ops.guard_cloud_final_source_writes();')
        assert 'unexpected dependent object' in sql(first, settings(first, mode='source-rollback')+release, fail=True)
        sql(first, 'DROP TRIGGER other_guard ON pc_ops.unrelated; DROP TABLE pc_ops.unrelated;')
        checks.append('changed-original-trigger-acl-and-extra-function-dependency-hold-release')
        second = start('b')
        source_sys = sysid(first)
        assert source_sys != sysid(second)
        guard(first)
        dump = docker(['exec', first, 'pg_dump', '-U', 'supabase_admin', '-d', database, '--format=custom',
                       '--schema=public','--schema=auth','--schema=storage','--schema=pc_ops']).stdout
        guard(second)
        docker(['exec','-i',second,'pg_restore','-U','supabase_admin','-d',database,'--single-transaction','--exit-on-error'],dump)
        assert '55000' in sql(second, 'UPDATE auth.users SET id=id WHERE false;', fail=True)
        assert 'does not match installed full fence' in sql(second, settings(second, mode='source-rollback', source=source_sys)+release, fail=True)
        sql(second, settings(second, mode='clone-restore', source=source_sys)+release)
        assert baseline(second) == before
        assert '55000' in sql(first, 'UPDATE auth.users SET id=id WHERE false;', fail=True)
        checks.append('full-clone-explicit-sys-release-preserves-original-tables-triggers-acls-and-source-fence')
        sql(first, settings(first, mode='source-rollback')+release)
        assert baseline(first) == before
        sql(first, "INSERT INTO public.members VALUES(2,'rollback-write');")
        assert sql(first, 'SELECT n FROM pc_ops.observations;') == '1'
        checks.append('nonowner-cascade-release-removes-only-fence-and-restores-behavior')
    finally:
        for name in list(created):
            guard(name)
            docker(['rm','-f',created[name]])
        if checks:
            print(json.dumps({'syntheticOnly':True,'checks':checks,'cleanup':True}))


if __name__ == '__main__':
    main()
