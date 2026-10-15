"""Opt-in real PostgreSQL fence/recovery tests, using two fresh isolated clusters.

python3 -B final-freeze.test.py --image sha256:<already-cached-image-id>
No pull, host listener, real DB connection, application env or member data.
Only exact UUID-named/labelled test containers created by this invocation are
removed. The Docker socket must be explicitly selected or the local default.
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
        parser.error('Use an already-cached immutable image ID')
    root = pathlib.Path(__file__).resolve().parent
    install = (root/'final-freeze.sql').read_text(encoding='utf-8')
    release = (root/'final-freeze-release.sql').read_text(encoding='utf-8')
    generation = str(uuid.uuid4())
    database = 'tuat_final_freeze_test'
    owner = 'codex-final-freeze-tests'
    created = {}
    checks = []

    def docker(argv, data=None, timeout=30, allowed_failure=False):
        result = subprocess.run(['docker', '--host', args.socket, *argv], input=data,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        if result.returncode and not allowed_failure:
            raise RuntimeError('Synthetic Docker/SQL command failed: '+result.stderr.decode(errors='replace')[-2000:])
        return result

    def guard(name):
        value = json.loads(docker(['inspect', name]).stdout)[0]
        if (name not in created or (created[name] is not None and value['Id'] != created[name])
                or value['Name'] != '/'+name or value['Image'] != args.image
                or value['Config']['Labels'].get('tuat.owner') != owner
                or value['Config']['Labels'].get('tuat.generation') != generation
                or value['HostConfig']['NetworkMode'] != 'none'
                or value['HostConfig'].get('PortBindings')
                or value['HostConfig'].get('Binds')
                or any(m['Type'] != 'tmpfs' for m in value['Mounts'])):
            raise RuntimeError('Synthetic container identity mismatch')
        created[name] = value['Id']

    def sql(name, statement, fail=False):
        guard(name)
        result = docker(['exec', '-i', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                         '-v', 'VERBOSITY=verbose', '-U', 'supabase_admin', '-d', database, '-f', '-'],
                        statement.encode(), allowed_failure=fail)
        if fail:
            if result.returncode == 0:
                raise AssertionError('Expected statement rejection')
            return result.stderr.decode(errors='replace')
        return result.stdout.decode().strip()

    def start(suffix):
        name = 'tuat-freeze-test-'+generation+'-'+suffix
        if docker(['container', 'ls', '-a', '--filter', 'name=^/'+name+'$', '--format', '{{.ID}}']).stdout.strip():
            raise RuntimeError('Synthetic name is not fresh')
        created[name] = None  # An uncertain start is inspected, never repeated.
        result = docker(['run', '-d', '--pull', 'never', '--name', name,
                         '--label', 'tuat.owner='+owner, '--label', 'tuat.generation='+generation,
                         '--network', 'none', '--memory', '768m', '--cpus', '1',
                         '--tmpfs', '/var/lib/postgresql/data:rw,size=512m',
                         '--tmpfs', '/tmp:rw,nosuid,nodev,size=32m',
                         '-e', 'POSTGRES_PASSWORD=isolated-final-freeze-test-only',
                         '-e', 'POSTGRES_DB='+database, args.image,
                         'postgres', '-D', '/etc/postgresql', '-c', 'listen_addresses=127.0.0.1',
                         '-c', 'cron.database_name='+database, '-c', 'cron.launch_active_jobs=off',
                         '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic'], timeout=60)
        identifier = result.stdout.decode().strip()
        if not re.fullmatch(r'[a-f0-9]{64}', identifier):
            raise RuntimeError('Unknown synthetic creation outcome')
        created[name] = identifier
        guard(name)
        ready = False
        for _ in range(120):
            pid1 = docker(['exec', name, 'cat', '/proc/1/comm'], allowed_failure=True)
            probe = docker(['exec', name, 'psql', '-X', '-qAt', '-U', 'supabase_admin',
                            '-d', database, '-c', 'SELECT 1'], allowed_failure=True)
            if pid1.stdout.strip() in (b'postgres', b'.postgres-wrapp') and probe.returncode == 0 and probe.stdout.strip() == b'1':
                ready = True
                break
            time.sleep(0.25)
        if not ready:
            raise RuntimeError('Synthetic PostgreSQL did not start')
        docker(['exec', name, 'dropdb', '--force', '-U', 'supabase_admin', database])
        docker(['exec', name, 'createdb', '-U', 'supabase_admin', '--template=template0', database])
        sql(name, 'DROP SCHEMA public;')
        return name

    def sysid(name):
        value = sql(name, 'SELECT system_identifier::text FROM pg_control_system();')
        if value in ('7686488340612984867', '7642734024280108049', '7696014892776206346'):
            raise RuntimeError('A production/candidate SYS cannot be a test fixture')
        return value

    inventory = """SELECT md5(coalesce(string_agg(format('%I.%I:%s',n.nspname,c.relname,c.relkind),E'\\n'
      ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"),''))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p');"""

    def settings(name, expected=None, mode=None):
        actual = sysid(name)
        values = {'expected_system_identifier': expected or actual, 'generation': generation}
        if mode:
            values['release_mode'] = mode
        else:
            values.update(forbidden_system_identifier='1000000000000000000',
                          expected_inventory_md5=sql(name, inventory), target_kind='old-primary')
        return '\n'.join("SET tuat.final_freeze."+key+" = '"+value+"';" for key, value in values.items())+'\n'

    def baseline(name):
        return sql(name, """SELECT jsonb_build_object(
          'triggers',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname)
            FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE NOT t.tgisinternal AND n.nspname IN ('public','storage','auth')),
          'acl',(SELECT jsonb_agg(jsonb_build_array(nspname,nspacl) ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('public','storage','auth','pc_ops')),
          'data',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.members t));""")

    try:
        first = start('a')
        sql(first, """CREATE SCHEMA public; CREATE SCHEMA storage; CREATE SCHEMA auth; CREATE SCHEMA pc_ops;
          CREATE TABLE pc_ops.observations (n integer NOT NULL); INSERT INTO pc_ops.observations VALUES(0);
          CREATE FUNCTION pc_ops.observe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE pc_ops.observations SET n=n+1; RETURN NULL; END $$;
          CREATE TABLE public.members (id integer PRIMARY KEY, value text); INSERT INTO public.members VALUES(1,'before');
          CREATE TRIGGER previous_observer AFTER INSERT ON public.members FOR EACH STATEMENT EXECUTE FUNCTION pc_ops.observe();
          CREATE TABLE public.partitioned (id integer) PARTITION BY RANGE(id);
          CREATE TABLE public.partitioned_child PARTITION OF public.partitioned FOR VALUES FROM(0) TO(10);
          CREATE TABLE storage.objects (id integer PRIMARY KEY); INSERT INTO storage.objects VALUES(1);
          CREATE TABLE auth.schema_migrations (version text PRIMARY KEY);
          CREATE TABLE auth.users (id integer PRIMARY KEY); INSERT INTO auth.users VALUES(1);
          CREATE TABLE auth.sessions (id integer PRIMARY KEY);
          DO $$ BEGIN FOR i IN 1..24 LOOP EXECUTE format('CREATE TABLE auth.fixture_%s (id integer)',i); END LOOP; END $$;
          GRANT USAGE ON SCHEMA public,storage,auth TO anon,authenticated,service_role;
          GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA public,storage,auth TO anon,authenticated,service_role;""")
        before = baseline(first)
        assert 'identity/settings mismatch' in sql(first, settings(first, '1000000000000000001')+install, fail=True)
        assert sql(first, "SELECT to_regclass('pc_ops.final_freeze_state') IS NULL;") == 't'
        checks.append('wrong-system-rejected-without-fence')
        dry = install.removesuffix('COMMIT;\n')+'ROLLBACK;\n'
        sql(first, settings(first)+dry)
        assert sql(first, "SELECT to_regclass('pc_ops.final_freeze_state') IS NULL;") == 't'
        assert baseline(first) == before
        checks.append('dry-run-fully-rolled-back')
        sql(first, settings(first)+install)
        assert baseline(first) != before
        assert 'already exists' in sql(first, settings(first)+install, fail=True)
        checks.append('second-install-held')
        for role in ('anon', 'authenticated', 'service_role', 'supabase_admin'):
            for mutation in ("INSERT INTO public.members VALUES(2,'blocked')", 'UPDATE public.members SET value=value WHERE false',
                             'DELETE FROM public.members WHERE false', 'TRUNCATE public.members',
                             'DELETE FROM storage.objects WHERE false', 'DELETE FROM auth.schema_migrations WHERE false',
                             'DELETE FROM auth.sessions WHERE false', 'DELETE FROM public.partitioned_child WHERE false'):
                prefix = "SET request.headers='{\"x-tuat-mirror\":\"1\"}'; SET pc_ops.restore='on'; SET ROLE "+role+';'
                assert '55000' in sql(first, prefix+mutation+';', fail=True)
        assert '55000' in sql(first, 'SET session_replication_role=replica; DELETE FROM auth.users WHERE false;', fail=True)
        assert sql(first, 'SELECT count(*) FROM pg_trigger WHERE tgname=\'pc_final_source_freeze\' AND tgenabled=\'A\';') == '31'
        checks.append('all-auth-table-scope-roles-mirror-restore-replica-zero-row-truncate-rejected')
        assert 'does not match installed fence' in sql(first, settings(first, mode='clone-restore')+release, fail=True)
        checks.append('clone-release-cannot-unfreeze-source')
        sql(first, 'ALTER TABLE public.members DISABLE TRIGGER previous_observer;')
        assert 'Original trigger catalog changed' in sql(first, settings(first, mode='source-rollback')+release, fail=True)
        assert '55000' in sql(first, 'DELETE FROM auth.users WHERE false;', fail=True)
        sql(first, 'ALTER TABLE public.members ENABLE TRIGGER previous_observer;')
        checks.append('changed-original-trigger-holds-release')

        second = start('b')
        assert sysid(first) != sysid(second)
        guard(first)
        dump = docker(['exec', first, 'pg_dump', '-U', 'supabase_admin', '-d', database, '--format=custom',
                       '--schema=public', '--schema=auth', '--schema=storage', '--schema=pc_ops']).stdout
        guard(second)
        docker(['exec', '-i', second, 'pg_restore', '-U', 'supabase_admin', '-d', database,
                '--single-transaction', '--exit-on-error'], dump)
        assert '55000' in sql(second, 'DELETE FROM auth.users WHERE false;', fail=True)
        assert 'does not match installed fence' in sql(second, settings(second, mode='source-rollback')+release, fail=True)
        sql(second, settings(second, mode='clone-restore')+release)
        assert baseline(second) == before
        sql(second, "INSERT INTO public.members VALUES(2,'clone-write');")
        assert '55000' in sql(first, 'DELETE FROM auth.users WHERE false;', fail=True)
        checks.append('dump-restore-keeps-fence-clone-release-preserves-source-and-original-triggers-acls-data')
        sql(first, settings(first, mode='source-rollback')+release)
        assert baseline(first) == before
        sql(first, "INSERT INTO public.members VALUES(2,'rollback-write');")
        assert sql(first, 'SELECT n FROM pc_ops.observations;') == '1'
        checks.append('source-rollback-restores-original-behavior')

        database = 'tuat_final_freeze_test_new_schema'
        guard(first)
        docker(['exec', first, 'createdb', '-U', 'supabase_admin', '--template=template0', database])
        sql(first, "CREATE SCHEMA storage; CREATE SCHEMA auth; CREATE TABLE public.members(id integer PRIMARY KEY); CREATE TABLE auth.users(id integer PRIMARY KEY);")
        before_new_schema = baseline(first)
        sql(first, settings(first)+install)
        assert sql(first, 'SELECT created_schema FROM pc_ops.final_freeze_state;') == 't'
        sql(first, settings(first, mode='source-rollback')+release)
        assert sql(first, "SELECT to_regnamespace('pc_ops') IS NULL;") == 't'
        assert baseline(first) == before_new_schema
        checks.append('new-fence-schema-is-removed-without-changing-original-acls')
    finally:
        for name in list(created):
            guard(name)
            docker(['rm', '-f', created[name]])
        if checks:
            print(json.dumps({'syntheticOnly': True, 'checks': checks, 'cleanup': True}))


if __name__ == '__main__':
    main()
