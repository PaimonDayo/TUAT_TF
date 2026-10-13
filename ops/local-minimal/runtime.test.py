"""Synthetic placement observations only; no Docker/unit/DB or private runtime reads."""
import importlib.util
import base64
import hashlib
import hmac
import json
import stat
import time
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).with_name('runtime.py'))
runtime = importlib.util.module_from_spec(spec); spec.loader.exec_module(runtime)


def config(uid=65530, gid=65530):
    c = {key: runtime.MOUNT + '/' + key for key in runtime.PATH_KEYS}
    c.update(version=1, installEnabled=True, sourceId='synthetic-source', mountPoint=runtime.MOUNT,
             mapperName='tuat-local-data', luksUuid='11111111-1111-4111-8111-111111111111',
             filesystemUuid='22222222-2222-4222-8222-222222222222', backingFile=None,
             appUid=uid, appGid=gid, nodePath='/opt/node-v24.19.0-linux-x64/bin/node')
    return c


def pc_config():
    c = config(); c.update(profile='pc-private', hostConfigPath=runtime.MOUNT+'/host.json', backupConfigPath=runtime.MOUNT+'/backup.json',
        offsiteConfigPath=runtime.MOUNT+'/private/offsite.json', sourceId='11111111-1111-4111-8111-111111111111',
        dbData=runtime.MOUNT+'/db', imageRoot=runtime.MOUNT+'/images',
        dbHba=runtime.MOUNT+'/db-private/pg_hba.conf',
        daemonSeal={key: 'a'*64 for key in ('dockerConfig', 'containerdConfig', 'dockerUnit', 'containerdUnit')})
    return c


def pc_services(c):
    secret = 'synthetic-local-signing-key-32-bytes-minimum'
    def token(role):
        encode = lambda v: base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
        parts = encode({'alg': 'HS256'})+'.'+encode({'iss': 'supabase', 'role': role, 'aud': 'authenticated', 'exp': int(time.time())+3600})
        return parts+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(), parts.encode(), hashlib.sha256).digest()).decode().rstrip('=')
    origin = 'https://synthetic.example.test'
    env = {k: 'true' for k in ('PC_APP_RUNTIME', 'NEXT_PUBLIC_PC_APP_RUNTIME', 'PC_LOCAL_RUNTIME', 'NEXT_PUBLIC_PC_LOCAL_RUNTIME', 'PC_BACKEND_ENABLED', 'NEXT_PUBLIC_PC_BACKEND')}
    env.update(APP_PUBLIC_ORIGIN=origin, NEXT_PUBLIC_SUPABASE_URL=origin+'/api/pc-supabase', PC_LOCAL_AUTH_URL='http://127.0.0.1:18301',
        PC_LOCAL_REST_URL='http://127.0.0.1:18302', IMAGE_STORAGE_DRIVER='local', LOCAL_IMAGE_STORAGE_ROOT=c['imageRoot'], R2_READ_ENABLED='false', R2_WRITE_ENABLED='false',
        NEXT_PUBLIC_SUPABASE_ANON_KEY=token('anon'), SUPABASE_SERVICE_ROLE_KEY=token('service_role'))
    db = dict(PGDATA='/var/lib/postgresql/data', POSTGRES_USER='postgres', POSTGRES_DB='synthetic', POSTGRES_PASSWORD='synthetic')
    auth = dict(GOTRUE_API_HOST='127.0.0.1', GOTRUE_API_PORT='18301', GOTRUE_DB_DRIVER='postgres', GOTRUE_DB_NAMESPACE='auth', GOTRUE_JWT_SECRET=secret,
        GOTRUE_DB_DATABASE_URL='postgres://supabase_auth_admin:synthetic@127.0.0.1:18304/synthetic?search_path=auth', GOTRUE_JWT_ADMIN_ROLES='service_role',
        GOTRUE_JWT_AUD='authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME='authenticated', GOTRUE_DISABLE_SIGNUP='true', GOTRUE_EXTERNAL_GOOGLE_ENABLED='true',
        GOTRUE_EXTERNAL_EMAIL_ENABLED='false', GOTRUE_EXTERNAL_PHONE_ENABLED='false', GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED='false', GOTRUE_SITE_URL=origin,
        API_EXTERNAL_URL=origin+'/api/pc-supabase/auth/v1', GOTRUE_URI_ALLOW_LIST=origin+'/auth/callback', GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=origin+'/api/pc-supabase/auth/v1/callback',
        GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED='true', GOTRUE_HOOK_BEFORE_USER_CREATED_URI='pg-functions://postgres/public/hook_restrict_signup_by_email_domain',
        GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID='synthetic', GOTRUE_EXTERNAL_GOOGLE_SECRET='synthetic')
    rest = dict(PGRST_SERVER_HOST='127.0.0.1', PGRST_SERVER_PORT='18302', PGRST_DB_SCHEMAS='public', PGRST_DB_ANON_ROLE='anon',
        PGRST_DB_URI='postgres://authenticator:synthetic@127.0.0.1:18304/synthetic', PGRST_JWT_SECRET='@/private/local-jwks.json')
    return env, db, auth, rest


class FakeCommands:
    def __init__(self, c):
        self.c, self.events, self.root, self.bad_containerd = c, [], c['dockerRoot'], False
        images, digests = runtime.image_contract(c); pc = c.get('profile') == 'pc-private'
        self.images = {tag: (pin, [digests[role]]) for role, (tag, pin) in images.items()}
        self.containers = {}
        for role, (tag, pin) in images.items():
            entry, args = runtime.CONTAINER_EXEC[role]
            mounts = {'db': [(c['dbData'], '/var/lib/postgresql/data', True)], 'auth': [],
                      'rest': [(c['mixedJwks'], '/private/mixed-jwks.json', False)]}[role]
            if pc:
                if role == 'db': mounts.append((c['dbHba'], '/private/pg_hba.conf', False)); args = runtime.PC_PG_COMMAND[:]
                if role == 'rest': mounts = [(c['mixedJwks'], '/private/local-jwks.json', False)]
            self.containers[role] = dict(id=role, name='/tuat-local-' + role, image=tag, imageId=pin,
                labels={'tuat.local.source': c['sourceId'], 'tuat.local.role': role, 'tuat.local.config-sha256': 'synthetic'},
                network='host', running=True, paused=False, privileged=False, readonly=True,
                user={'db':'100:101', 'auth':'65529:65529', 'rest':'65528:65528'}[role] if pc else ('100:101' if role == 'db' else '1000:1000'), entrypoint=entry, command=args,
                pgSocketEnv='PGHOST=/tmp;PGPORT=18304;' if pc and role == 'db' else '',
                tmpfs={'/tmp':'rw,noexec,nosuid,nodev,size='+('64m' if role == 'db' else '32m')+',mode=1777'} if pc else {},
                securityOpt=['no-new-privileges:true'], capDrop=['ALL'], capAdd=[],
                mounts=[dict(Type='bind', Source=a, Destination=b, RW=d) for a, b, d in mounts])

    def run(self, args, **_kwargs):
        self.events.append(args)
        if args[:2] == ['docker', 'info']: return self.root
        if args == ['docker', 'ps', '-aq']: return 'db auth rest'
        if args[:2] == ['systemctl', 'list-units']: return ''
        if args[:2] == ['systemctl', 'show']:
            if args[2] in ('docker.service', 'containerd.service'):
                return '/usr/bin/dockerd -H fd://' if args[2] == 'docker.service' else '/usr/bin/containerd'
            return 'LoadState=not-found\nActiveState=inactive\nSubState=dead\nFreezerState=running\nMainPID=0\nControlPID=0\nControlGroup='
        if args[:2] == ['cryptsetup', 'status']: return ' type: LUKS2\n mode: read/write\n device: /dev/synthetic'
        if args[:2] == ['cryptsetup', 'luksUUID']: return self.c['luksUuid']
        raise AssertionError('Unexpected synthetic command')

    def obj(self, args):
        if args[0] == 'findmnt':
            return {'filesystems': [dict(target=runtime.MOUNT, fstype='ext4', uuid=self.c['filesystemUuid'],
                     options='rw', source='/dev/mapper/' + self.c['mapperName'])]}
        if args[:3] == ['docker', 'image', 'inspect']:
            pin, digests = self.images[args[3]]
            return pin if args[-1] == '{{json .Id}}' else digests
        if args[:2] == ['docker', 'inspect']: return self.containers[args[2]]
        raise AssertionError('Unexpected synthetic observation')

    def containerd_storage(self, _c):
        self.events.append('active-containerd-storage')
        if self.bad_containerd: raise runtime.Hold('containerd-active-storage')


class RuntimeBehaviour(unittest.TestCase):
    def test_bound_config_files_require_canonical_encrypted_root_private_metadata(self):
        name=runtime.MOUNT+'/private/config.json'; fault=[{}]
        def observed(path):
            file=str(path)==name
            fields=dict(st_mode=(stat.S_IFREG|0o600) if file else (stat.S_IFDIR|0o700),st_uid=0,st_gid=0,st_nlink=1,st_dev=2)
            if str(path)==fault[0].get('path'): fields.update(fault[0].get('stat',{}))
            return SimpleNamespace(**fields)
        with patch.object(Path,'stat',autospec=True,side_effect=observed), \
             patch.object(Path,'is_symlink',autospec=True,side_effect=lambda path:str(path)==fault[0].get('symlink')):
            self.assertEqual(runtime.pc_private_binding_file(name,2),Path(name))
            for bad in ({'path':name,'stat':{'st_uid':65530}}, {'path':name,'stat':{'st_mode':stat.S_IFREG|0o640}},
                {'path':name,'stat':{'st_nlink':2}}, {'path':name,'stat':{'st_dev':3}},
                {'path':str(Path(name).parent),'stat':{'st_mode':stat.S_IFDIR|0o750}}, {'symlink':name}):
                fault[0]=bad
                with self.assertRaises(runtime.Hold): runtime.pc_private_binding_file(name,2)
            fault[0]={}
            for path in ('/outside/config.json',runtime.MOUNT+'/private/../config.json',runtime.MOUNT+'/private/./config.json',None):
                with self.assertRaisesRegex(runtime.Hold,'private-path'): runtime.pc_private_binding_file(path,2)

    def test_actual_pc_db_id_and_config_label_must_match_sealed_node_target(self):
        c=pc_config(); target={'containerId':'db','configSha256':'synthetic'}
        with patch.object(runtime,'pc_db_hba'), patch.object(runtime,'json_private',return_value={}), \
             patch.object(runtime,'pc_node_backup',side_effect=lambda *_args:{'target':target}), \
             patch.object(runtime,'compose_env',return_value={f'TUAT_{role.upper()}_HASH':'synthetic' for role in runtime.IMAGES}):
            runtime.host_gate(c,FakeCommands(c))
            for key,value in (('containerId','other-physical-db'),('configSha256','different-env-hash')):
                prior=target[key]; target[key]=value
                with self.assertRaisesRegex(runtime.Hold,'pc-db-backup-target'): runtime.host_gate(c,FakeCommands(c))
                target[key]=prior

    def test_pc_hba_binds_canonical_scram_source_and_root_db_reader_while_app_cannot_read(self):
        c = pc_config(); source = Path(c['releaseDirectory'])/runtime.PC_HBA_SOURCE
        canonical = (Path(__file__).parent/'pc/pg_hba.conf').read_bytes()
        data = [canonical]; fault = [{}]
        def observed(path):
            directory = path not in (Path(c['dbHba']), source)
            owner, group, mode = 0, 0, 0o755
            if path == Path(c['dbHba']).parent: group, mode = 101, 0o750
            if path == Path(c['dbHba']): group, mode = 101, 0o640
            if path == source: mode = 0o644
            fields = dict(st_mode=(stat.S_IFDIR if directory else stat.S_IFREG)|mode, st_uid=owner, st_gid=group,
                st_dev=2, st_size=len(data[0]), st_nlink=1)
            if path == Path(c['dbHba']): fields.update(fault[0])
            return SimpleNamespace(**fields)
        with patch.object(Path, 'stat', autospec=True, side_effect=observed), patch.object(Path, 'is_symlink', return_value=False), \
             patch.object(Path, 'read_bytes', side_effect=lambda:data[0]), patch.object(runtime, 'file_digest', side_effect=lambda _path:runtime.digest(data[0])):
            manifest = lambda: {'files':{runtime.PC_HBA_SOURCE:runtime.digest(data[0])}}
            runtime.pc_db_hba(c, manifest())
            with self.assertRaisesRegex(runtime.Hold, 'app-traverse'):
                runtime.app_access(c['dbHba'], uid=65530, gid=65530)
            for bad in ({'st_uid':100}, {'st_gid':65530}, {'st_mode':stat.S_IFREG|0o660}, {'st_dev':3}, {'st_nlink':2}):
                fault[0] = bad
                with self.assertRaises(runtime.Hold): runtime.pc_db_hba(c, manifest())
            fault[0] = {}
            with self.assertRaisesRegex(runtime.Hold, 'installed-seal'): runtime.pc_db_hba(c, {'files':{runtime.PC_HBA_SOURCE:'a'*64}})
            data[0] = canonical.replace(b'127.0.0.1/32 scram-sha-256', b'127.0.0.1/32 trust')
            with self.assertRaisesRegex(runtime.Hold, 'hba-rules'): runtime.pc_db_hba(c, manifest())
            data[0] = canonical + b'include /synthetic/other.conf\n'
            with self.assertRaisesRegex(runtime.Hold, 'hba-rules'): runtime.pc_db_hba(c, manifest())

    def test_pc_db_tcp_credentials_must_not_be_missing_or_replaced_by_host_trust(self):
        c = pc_config(); inputs = pc_services(c)
        for index, key, value in ((1,'POSTGRES_PASSWORD',''), (1,'POSTGRES_HOST_AUTH_METHOD','trust'),
            (2,'GOTRUE_DB_DATABASE_URL','postgres://supabase_auth_admin@127.0.0.1:18304/synthetic?search_path=auth'),
            (3,'PGRST_DB_URI','postgres://authenticator@127.0.0.1:18304/synthetic')):
            changed = [dict(v) for v in inputs]; changed[index][key] = value
            with self.assertRaises(runtime.Hold, msg=key): runtime.pc_service_configuration(c, *changed)

    def test_pc_db_actual_command_and_readonly_hba_mount_are_required_without_changing_surface(self):
        c = pc_config()
        with patch.object(runtime, 'pc_db_hba'), patch.object(runtime, 'json_private', return_value={}), patch.object(runtime,'pc_node_backup',return_value={'target':{'containerId':'db','configSha256':'synthetic'}}), \
             patch.object(runtime, 'compose_env', return_value={f'TUAT_{role.upper()}_HASH': 'synthetic' for role in runtime.IMAGES}):
            self.assertEqual(runtime.host_gate(c, FakeCommands(c)), dict(db='db', auth='auth', rest='rest'))
            for fault in ('missing-command', 'writable-hba', 'pg-owned-hba'):
                cmd = FakeCommands(c)
                if fault == 'missing-command': cmd.containers['db']['command'] = runtime.PC_PG_COMMAND[:-2]
                if fault == 'writable-hba': cmd.containers['db']['mounts'][1]['RW'] = True
                if fault == 'pg-owned-hba': cmd.containers['db']['mounts'][1]['Source'] = c['dbData']+'/pg_hba.conf'
                with self.assertRaises(runtime.Hold, msg=fault): runtime.host_gate(c, cmd)
            surface = config()
            self.assertEqual(runtime.host_gate(surface, FakeCommands(surface)), dict(db='db', auth='auth', rest='rest'))

    def test_pc_tmpfs_is_private_bounded_and_all_actual_mounts_are_checked(self):
        c = pc_config()
        with patch.object(runtime, 'pc_db_hba'), patch.object(runtime, 'json_private', return_value={}), patch.object(runtime,'pc_node_backup',return_value={'target':{'containerId':'db','configSha256':'synthetic'}}), \
             patch.object(runtime, 'compose_env', return_value={f'TUAT_{role.upper()}_HASH':'synthetic' for role in runtime.IMAGES}):
            for role in ('db','auth','rest'):
                cmd = FakeCommands(c)
                cmd.containers[role]['mounts'].append(dict(Type='tmpfs',Source='',Destination='/tmp',RW=True))
                self.assertEqual(runtime.host_gate(c, cmd), dict(db='db',auth='auth',rest='rest'))
                size = '64m' if role == 'db' else '32m'
                for fault in ('missing','extra-path','wrong-size','wrong-mode','missing-nodev','extra-option','duplicate-option',
                              'shared-bind','shared-volume','extra-volume','extra-tmpfs','readonly-tmpfs','duplicate-tmpfs'):
                    cmd = FakeCommands(c); info = cmd.containers[role]
                    if fault == 'missing': info.pop('tmpfs')
                    if fault == 'extra-path': info['tmpfs']['/other'] = info['tmpfs']['/tmp']
                    if fault == 'wrong-size': info['tmpfs']['/tmp'] = info['tmpfs']['/tmp'].replace('size='+size,'size=128m')
                    if fault == 'wrong-mode': info['tmpfs']['/tmp'] = info['tmpfs']['/tmp'].replace('mode=1777','mode=0777')
                    if fault == 'missing-nodev': info['tmpfs']['/tmp'] = info['tmpfs']['/tmp'].replace('nodev,','')
                    if fault == 'extra-option': info['tmpfs']['/tmp'] += ',uid=1000'
                    if fault == 'duplicate-option': info['tmpfs']['/tmp'] += ',rw'
                    if fault in ('shared-bind','shared-volume','extra-volume','extra-tmpfs','readonly-tmpfs','duplicate-tmpfs'):
                        kind = 'bind' if fault == 'shared-bind' else 'volume' if fault in ('shared-volume','extra-volume') else 'tmpfs'
                        mount = dict(Type=kind,Source='/synthetic/shared' if kind != 'tmpfs' else '',
                            Destination='/other' if fault in ('extra-volume','extra-tmpfs') else '/tmp',RW=fault != 'readonly-tmpfs')
                        info['mounts'].append(mount)
                        if fault == 'duplicate-tmpfs': info['mounts'].append(dict(mount))
                    with self.assertRaises(runtime.Hold, msg=role+':'+fault): runtime.host_gate(c, cmd)
            # The old omitted-profile acceptance is unchanged by PC-only mount checks.
            surface = config(); cmd = FakeCommands(surface)
            cmd.containers['auth'].pop('tmpfs'); cmd.containers['auth']['mounts'].append(dict(Type='volume',Source='/old',Destination='/tmp',RW=True))
            self.assertEqual(runtime.host_gate(surface,cmd),dict(db='db',auth='auth',rest='rest'))

    def test_pc_enum_pins_actor_and_defaults_keep_original_surface_socket(self):
        runtime.config_shape(pc_config())
        self.assertEqual(runtime.periodic.installation_profile({})['socket'], 'unix:///var/run/docker.sock')
        self.assertEqual(runtime.periodic.installation_profile(pc_config())['socket'], 'unix:///run/tuat-local/docker.sock')
        for value in ('other', None, True):
            with self.assertRaises(runtime.periodic.Hold): runtime.periodic.installation_profile({'profile': value})
        for field, value in (('appUid', 1000), ('appGid', 1000), ('daemonSeal', {}), ('offsiteConfigPath','/outside/offsite.json')):
            c = pc_config(); c[field] = value
            with self.assertRaises(runtime.Hold): runtime.config_shape(c)

    def test_private_socket_transport_never_falls_back_on_failure(self):
        cmd = runtime.Commands(None, pc_config())
        with patch.object(cmd, 'record'), patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout=b'', stderr=b'')) as run:
            with self.assertRaises(runtime.Hold): cmd.run(['docker', 'info'])
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0], ['docker', '--host', 'unix:///run/tuat-local/docker.sock', '--config', '/nonexistent', 'info'])

    def test_pc_google_signup_hold_and_local_issuer_cannot_mix_surface_settings(self):
        c = pc_config(); inputs = pc_services(c)
        self.assertEqual(runtime.pc_service_configuration(c, *inputs), 'https://synthetic.example.test')
        for index, field, value in ((0, 'NEXT_PUBLIC_CLOUD_AUTH_URL', 'https://synthetic.supabase.co'), (0, 'NEXT_PUBLIC_CLOUD_AUTH_UNUSED', ''),
            (0, 'PC_LOCAL_AUTH_URL', 'http://127.0.0.1:18001'), (2, 'GOTRUE_DISABLE_SIGNUP', 'false'), (2, 'GOTRUE_EXTERNAL_GOOGLE_ENABLED', 'false'),
            (2, 'GOTRUE_EXTERNAL_EMAIL_ENABLED', 'true'), (3, 'PGRST_APP_SETTINGS_CLOUD_ISSUER', 'synthetic'), (3, 'PGRST_JWT_SECRET', '@other')):
            changed = [dict(item) for item in inputs]; changed[index][field] = value
            with self.assertRaises(runtime.Hold, msg=field): runtime.pc_service_configuration(c, *changed)

    def test_private_daemons_require_same_tracked_installed_hash_and_actual_exact_argv(self):
        c = pc_config(); p = runtime.periodic.installation_profile(c)
        cmd = FakeCommands(c)
        def run(args, **_kwargs):
            unit = args[2]; pid = '321' if unit == p['dockerUnit'] else '322'
            return '\n'.join(f'{k}={v}' for k,v in dict(LoadState='loaded', ActiveState='active', SubState='running', MainPID=pid, ControlPID='0',
                User='root', FragmentPath='/etc/systemd/system/'+unit, DropInPaths='', InvocationID='a'*32, ControlGroup='/system.slice/'+unit, ExecStart='synthetic').items())
        cmd.run = run
        process = MagicMock(); proc_root = MagicMock(); proc_root.__truediv__.return_value = process
        wrong = [False]
        def child(name):
            if name == 'cmdline':
                role = 'docker' if selected[0] == '321' else 'containerd'
                return SimpleNamespace(read_bytes=lambda: ('\0'.join(runtime.periodic.daemon_argv(p, role) + (['--root=/bad'] if wrong[0] else []))+'\0').encode())
            return SimpleNamespace(read_text=lambda: '0::/system.slice/'+(p['dockerUnit'] if selected[0] == '321' else p['containerdUnit']))
        selected = ['321']
        proc_root.__truediv__.side_effect = lambda pid: (selected.__setitem__(0,pid) or process)
        process.__truediv__.side_effect = child; process.stat.return_value = SimpleNamespace(st_uid=0)
        real_path = Path
        def paths(value): return proc_root if value == '/proc' else real_path(value)
        files = {'ops/local-minimal/pc/'+Path(p[k]).name: 'a'*64 for k in ('dockerConfig','containerdConfig','dockerUnit','containerdUnit')}
        with patch.object(runtime, 'Path', side_effect=paths), patch.object(runtime, 'existing', side_effect=lambda path, **_kwargs:path), \
             patch.object(runtime, 'file_digest', return_value='a'*64), patch.object(runtime, 'json_private', return_value={'files':files}):
            runtime.private_daemon_units(c, cmd)
            wrong[0] = True
            with self.assertRaisesRegex(runtime.Hold, 'pc-daemon-process'): runtime.private_daemon_units(c, cmd)
            wrong[0] = False
            with patch.object(runtime, 'file_digest', return_value='b'*64):
                with self.assertRaisesRegex(runtime.Hold, 'file-seal'): runtime.private_daemon_units(c, cmd)

    def test_pc_crypto_storage_preserves_source_import_socket_swap_and_real_daemon_refusals(self):
        c = pc_config(); c['dockerRoot'] = runtime.MOUNT+'/docker'; c['containerdRoot'] = runtime.MOUNT+'/containerd'
        source = Path(__file__).parent/'pc'
        daemon = json.loads((source/'docker.json').read_bytes())
        containerd_text = (source/'containerd.toml').read_text()
        observations = {'swap': '', 'group': 0, 'daemon': daemon, 'containerd': containerd_text}
        def paths(value):
            if value in (runtime.MOUNT, '/'):
                return SimpleNamespace(stat=lambda: SimpleNamespace(st_dev=2 if value == runtime.MOUNT else 1))
            if value == '/proc/swaps': return SimpleNamespace(read_text=lambda: observations['swap'])
            if value == '/etc/fstab': return SimpleNamespace(read_text=lambda: '')
            raise AssertionError('Unexpected live storage observation')
        def existing(path, *_args, **kwargs):
            if path == '/etc/tuat-local/docker.json': return SimpleNamespace(read_bytes=lambda: json.dumps(observations['daemon']).encode())
            if path == '/etc/tuat-local/containerd.toml': return SimpleNamespace(read_text=lambda: observations['containerd'])
            if path == c['dockerRoot']: self.assertEqual(kwargs['mode'], 0o710)
            return SimpleNamespace(stat=lambda: SimpleNamespace(st_dev=2, st_gid=observations['group']))
        with patch.object(runtime, 'Path', side_effect=paths), patch.object(runtime, 'config_shape'), \
             patch.object(runtime, 'existing', side_effect=existing), patch.object(runtime, 'private_daemon_units') as units:
            cmd = FakeCommands(c); runtime.storage_gate(c, cmd); units.assert_called_once()
            cases = [('daemon', {**daemon, 'hosts': ['unix:///var/run/docker.sock']}), ('daemon', {**daemon, 'containerd': '/run/containerd/containerd.sock'}),
                ('containerd', containerd_text.replace('imports = []', 'imports = ["/etc/containerd/config.toml"]')),
                ('containerd', containerd_text.replace('/run/tuat-local/containerd/containerd.sock.ttrpc', '/run/containerd/ttrpc.sock')),
                ('swap', 'Filename Type Size Used Priority\n/synthetic/swap file 1 0 -2\n'), ('group', 65530)]
            for key, value in cases:
                original = observations[key]; observations[key] = value
                with self.assertRaises(runtime.Hold, msg=key): runtime.storage_gate(c, cmd)
                observations[key] = original
            cmd.root = '/plain/root'
            with self.assertRaisesRegex(runtime.Hold, 'docker-runtime-root'): runtime.storage_gate(c, cmd)

    def test_pc_jwk_is_one_local_oct_with_root_rest_reader_only(self):
        c = pc_config(); auth = {'GOTRUE_JWT_SECRET': 's'*32}
        payload = {'keys': [{'kty': 'oct', 'alg': 'HS256', 'k': base64.urlsafe_b64encode(b's'*32).decode().rstrip('=')}]}
        stat = SimpleNamespace(st_gid=65528, st_size=100)
        real_path = Path
        with patch.object(runtime, 'existing'), patch.object(real_path, 'stat', return_value=stat), \
             patch.object(real_path, 'read_bytes', side_effect=lambda: json.dumps(payload).encode()):
            runtime.pc_rest_jwks(c, auth)
            stat.st_gid = 65530
            with self.assertRaisesRegex(runtime.Hold, 'jwk-reader'): runtime.pc_rest_jwks(c, auth)
            stat.st_gid = 65528; payload['keys'].append({'kty': 'EC', 'alg': 'ES256'})
            with self.assertRaisesRegex(runtime.Hold, 'local-only'): runtime.pc_rest_jwks(c, auth)

    def test_pc_jwt_audience_absence_is_allowed_but_other_audience_is_refused(self):
        inputs = pc_services(pc_config()); token = inputs[0]['NEXT_PUBLIC_SUPABASE_ANON_KEY']; secret = inputs[2]['GOTRUE_JWT_SECRET']
        header, claims, _ = token.split('.')
        body = json.loads(runtime.decode64(claims)); del body['aud']
        def signed(value):
            part = base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('='); data = header+'.'+part
            return data+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(), data.encode(), hashlib.sha256).digest()).decode().rstrip('=')
        runtime.jwt_valid(signed(body), secret, 'anon', allow_absent_audience=True)
        with self.assertRaisesRegex(runtime.Hold, 'jwt-claims'): runtime.jwt_valid(signed(body), secret, 'anon')
        with self.assertRaisesRegex(runtime.Hold, 'jwt-claims'): runtime.jwt_valid(signed({**body, 'aud': 'other'}), secret, 'anon', allow_absent_audience=True)

    def test_full_pc_configuration_binds_root_supervisors_and_keeps_jobs_disabled(self):
        c = pc_config(); env, db, auth, rest = pc_services(c); env['PC_APP_RELEASE_ID'] = 'synthetic-release'
        manifest = dict(version=1, nodeVersion='v24.19.0', sourceCommit='a'*40, releaseId='synthetic-release', publicOrigin=env['APP_PUBLIC_ORIGIN'],
            appEnvironmentSha256=runtime.digest(b'synthetic'), nodeSha256='b'*64, files={name:'c'*64 for name in
                ('.next/BUILD_ID','.next/required-server-files.json','ops/pc-host/run.mjs','ops/pc-host/linux-launch.py','ops/pc-host/runner-lock.mjs','ops/pc-host/release.mjs',
                 'ops/pc-jobs/run.mjs','ops/pc-jobs/shared-pc.mjs','src/lib/supabase/cloud-auth.ts','ops/local-minimal/pc/compose.yaml',runtime.PC_HBA_SOURCE)}, links={})
        for key in ('hostConfigPath','jobsConfig','backupConfigPath'): manifest[key+'Sha256'] = runtime.digest(b'synthetic')
        host = dict(releaseDirectory=c['releaseDirectory'], environmentFile=c['appEnvironmentFile'], releaseCommit=manifest['sourceCommit'],
            releaseId=manifest['releaseId'], publicOrigin=env['APP_PUBLIC_ORIGIN'], appPort=18200, applicationUid=65530, applicationGid=65530, enabled=False,
            stateDirectory=runtime.MOUNT+'/host-state', backupConfigFile=runtime.MOUNT+'/private/node-backup.json',
            expectedBackupInstanceId=c['sourceId'], expectedBackupDatabaseSystemIdentifier='1234567890123456789', expectedBackupDatabaseName=db['POSTGRES_DB'])
        jobs = dict(runtime='shared-pc', enabled=False, releaseDirectory=c['releaseDirectory'], environmentFile=c['appEnvironmentFile'], stateDirectory=c['jobsStateRoot'],
            appOrigin='http://127.0.0.1:18200', port=18200, releaseCommit=manifest['sourceCommit'], releaseId=manifest['releaseId'], hostStateDirectory=host['stateDirectory'])
        backup = dict(profile='pc-private', sourceId=c['sourceId'], sourceOwnerUid=65530, imageRoot=c['imageRoot'], jobsStateRoot=c['jobsStateRoot'], database=db['POSTGRES_DB'],
            periodic={'configPath': c['backupConfigPath']}, backupRoot=runtime.MOUNT+'/python-backup',receiptFile=runtime.MOUNT+'/python-backup/receipt.json')
        node = dict(profile='pc-private',executionMode='linux',dockerSocket='unix:///run/tuat-local/docker.sock',instanceId=c['sourceId'],
            localImageRoot=c['imageRoot'],stateDirectory=runtime.MOUNT+'/node-backup-state',environmentFile=runtime.MOUNT+'/private/provider.env',
            localSnapshotReceiptFile=runtime.MOUNT+'/offsite-state/local-snapshot.json',target=dict(containerId='d'*64,containerImageId=runtime.PC_IMAGES['db'][1],
                containerName='tuat-local-db',sourceLabel=c['sourceId'],roleLabel='db',configSha256='e'*64,dataMountSource=c['dbData'],
                databaseName=db['POSTGRES_DB'],databaseSystemIdentifier=host['expectedBackupDatabaseSystemIdentifier']))
        offsite = dict(profile='pc-private',sourceId=c['sourceId'],databaseSystemIdentifier=host['expectedBackupDatabaseSystemIdentifier'],imageRoot=c['imageRoot'],
            hostConfigFile=c['hostConfigPath'],producerReceiptFile=backup['receiptFile'],stateDirectory=runtime.MOUNT+'/offsite-state',environmentFile=node['environmentFile'],
            generation='this-static-value-is-not-an-active-host-generation')
        for key in ('nodeBackupConfigSha256','offsiteConfigPathSha256','offsiteEnvironmentSha256'): manifest[key]=runtime.digest(b'synthetic')
        configurations = {c['releaseManifest']:manifest, c['hostConfigPath']:host, c['jobsConfig']:jobs, c['backupConfigPath']:backup,
            host['backupConfigFile']:node,c['offsiteConfigPath']:offsite}
        environments = {c['appEnvironmentFile']:env, c['dbEnvironmentFile']:db, c['authEnvironmentFile']:auth, c['restEnvironmentFile']:rest}
        with patch.object(Path, 'stat', return_value=SimpleNamespace(st_dev=2)), patch.object(runtime, 'env_private', side_effect=lambda path:environments[path]), \
             patch.object(runtime, 'private_bytes', return_value=b'synthetic'), patch.object(runtime, 'json_private', side_effect=lambda path, **_kw:configurations[str(path)]), \
             patch.object(runtime, 'release_inventory', return_value={'files':manifest['files'], 'links':{}}), patch.object(runtime, 'existing',side_effect=lambda path,*_a,**_kw:Path(path)) as existing, \
             patch.object(runtime, 'app_access'), patch.object(runtime, 'compose_gate'), patch.object(runtime, 'pc_rest_jwks'), patch.object(runtime, 'pc_db_hba'), \
             patch.object(runtime,'compose_env',return_value={'TUAT_DB_HASH':'e'*64}):
            self.assertEqual(runtime.pc_configuration_gate(c)[1], jobs)
            self.assertIn(unittest.mock.call(c['jobsStateRoot'], True, 0, 0o700), existing.call_args_list)
            self.assertIn(unittest.mock.call(c['imageRoot'], True, 65530, 0o700), existing.call_args_list)
            for obj,key,value,code in ((host,'expectedBackupDatabaseName','other_valid','host-identity'),(host,'expectedBackupInstanceId','22222222-2222-4222-8222-222222222222','host-identity'),
                (node,'profile','surface','node-backup-contract'),(node,'executionMode','wsl','node-backup-contract'),(node,'dockerSocket','unix:///var/run/docker.sock','node-backup-contract'),
                (node,'instanceId','22222222-2222-4222-8222-222222222222','node-backup-contract'),(node,'localImageRoot',runtime.MOUNT+'/other-images','node-backup-contract'),
                (node['target'],'containerId','not-a-physical-id','node-backup-target'),(node['target'],'databaseName','other_valid','node-backup-target'),(node['target'],'databaseSystemIdentifier','9876543210987654321','node-backup-target'),
                (node['target'],'sourceLabel','22222222-2222-4222-8222-222222222222','node-backup-target'),(node['target'],'roleLabel','rest','node-backup-target'),
                (node['target'],'configSha256','f'*64,'node-backup-target'),(node['target'],'dataMountSource',runtime.MOUNT+'/other-db','node-backup-target'),
                (offsite,'profile','surface','offsite-contract'),(offsite,'sourceId','22222222-2222-4222-8222-222222222222','offsite-contract'),
                (offsite,'databaseSystemIdentifier','9876543210987654321','offsite-contract'),(offsite,'hostConfigFile',runtime.MOUNT+'/other-host.json','offsite-contract'),
                (offsite,'producerReceiptFile',runtime.MOUNT+'/other-receipt.json','offsite-contract'),(offsite,'imageRoot',runtime.MOUNT+'/other-images','offsite-contract'),
                (offsite,'stateDirectory','/outside-state','state-path'),
                (node,'localSnapshotReceiptFile',runtime.MOUNT+'/other-state/local-snapshot.json','receipt-paths'),
                (offsite,'environmentFile',runtime.MOUNT+'/other-provider.env','environment-binding'),
                (manifest,'nodeBackupConfigSha256','a'*64,'node-backup-seal'),(manifest,'offsiteConfigPathSha256','a'*64,'offsite-config-seal'),
                (manifest,'offsiteEnvironmentSha256','a'*64,'environment-seal')):
                prior=obj[key];obj[key]=value
                with self.assertRaisesRegex(runtime.Hold,code,msg=key): runtime.pc_configuration_gate(c)
                obj[key]=prior
            backup['database'] = 'different_valid_database'
            with self.assertRaisesRegex(runtime.Hold, 'backup-contract'): runtime.pc_configuration_gate(c)
            backup['database'] = db['POSTGRES_DB']
            backup['sourceOwnerUid']=65530.0
            with self.assertRaisesRegex(runtime.Hold,'backup-contract'): runtime.pc_configuration_gate(c)
            backup['sourceOwnerUid']=65530
            jobs['enabled'] = True
            with self.assertRaisesRegex(runtime.Hold, 'jobs-preparation'): runtime.pc_configuration_gate(c)
            jobs['enabled'] = False; host['applicationUid'] = 0
            with self.assertRaisesRegex(runtime.Hold, 'host-contract'): runtime.pc_configuration_gate(c)

    def test_pc_execution_delegates_root_wrapper_without_surface_privilege_drop(self):
        c = pc_config(); manifest = {'nodeSha256':'a'*64}
        with patch.object(runtime.resource, 'setrlimit'), patch.object(runtime.os, 'umask'), patch.object(runtime.os, 'execve') as execute, \
             patch.object(runtime.os, 'setuid') as drop:
            runtime.exec_runtime(c, '--app', {}, {'enabled':False}, FakeCommands(c), {}, manifest)
            drop.assert_not_called()
            self.assertEqual(execute.call_args.args[1], ['/usr/bin/python3','-I',c['releaseDirectory']+'/ops/pc-host/linux-launch.py',
                '--service','app','--config',c['hostConfigPath'],'--node-sha256','a'*64])
            self.assertFalse(any(k.startswith('TUAT_') for k in execute.call_args.args[2]))
            with self.assertRaisesRegex(runtime.Hold, 'jobs-disabled'): runtime.exec_runtime(c, '--jobs', {}, {'enabled':False}, FakeCommands(c), {}, manifest)

    def test_explicit_numeric_actor_accepts_legacy_and_current_but_not_privileged_or_coerced_ids(self):
        for uid, gid in ((1000, 1000), (65530, 65530), (65530, 65531)):
            runtime.config_shape(config(uid, gid))
        for value in (0, 999, True, 65530.0, '65530', 2**32-1):
            for field in ('appUid', 'appGid'):
                c = config(); c[field] = value
                with self.assertRaisesRegex(runtime.Hold, 'config-uid'): runtime.config_shape(c)

    def test_reader_uses_actual_actor_group_and_owner_permissions_without_falling_back(self):
        parent = SimpleNamespace(stat=lambda: SimpleNamespace(st_mode=0o40750, st_uid=0, st_gid=65530))
        leaf = SimpleNamespace(parents=(parent,), stat=lambda: SimpleNamespace(st_mode=0o100640, st_uid=0, st_gid=65530))
        with patch.object(runtime, 'Path', return_value=leaf):
            runtime.app_access('/synthetic/receipt', uid=65530, gid=65530)
            with self.assertRaisesRegex(runtime.Hold, 'app-traverse'): runtime.app_access('/synthetic/receipt')
            with self.assertRaisesRegex(runtime.Hold, 'app-traverse'): runtime.app_access('/synthetic/receipt', uid=65530, gid=1000)
            leaf.stat = lambda: SimpleNamespace(st_mode=0o100200, st_uid=65530, st_gid=65530)
            with self.assertRaisesRegex(runtime.Hold, 'app-read-execute'): runtime.app_access('/synthetic/receipt', uid=65530, gid=65530)

    def test_exact_gotrue_2197_image_and_role_are_required(self):
        c = pc_config(); cmd = FakeCommands(c)
        self.assertEqual(runtime.PC_IMAGES['auth'], ('supabase/gotrue:v2.197.0', 'sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b'))
        self.assertEqual(runtime.image_contract(config())[0]['auth'][0], 'supabase/gotrue:v2.196.0')
        with patch.object(runtime, 'pc_db_hba'), patch.object(runtime, 'json_private', return_value={}), patch.object(runtime,'pc_node_backup',return_value={'target':{'containerId':'db','configSha256':'synthetic'}}), \
             patch.object(runtime, 'compose_env', return_value={f'TUAT_{role.upper()}_HASH': 'synthetic' for role in runtime.PC_IMAGES}):
            self.assertEqual(runtime.host_gate(c, cmd), dict(db='db', auth='auth', rest='rest'))
            for fault in ('old-tag', 'config-id', 'repo-digest', 'wrong-role'):
                bad = FakeCommands(c)
                if fault == 'old-tag': bad.containers['auth']['image'] = 'supabase/gotrue:v2.196.0'
                if fault == 'config-id': bad.containers['auth']['imageId'] = 'sha256:' + '0'*64
                if fault == 'repo-digest': bad.images[runtime.PC_IMAGES['auth'][0]] = (runtime.PC_IMAGES['auth'][1], ['supabase/gotrue@sha256:' + '0'*64])
                if fault == 'wrong-role': bad.containers['auth']['labels']['tuat.local.role'] = 'rest'
                with self.assertRaises(runtime.Hold, msg=fault): runtime.host_gate(c, bad)

    def test_storage_only_crypto_gate_also_requires_actual_daemon_storage(self):
        c = config()
        def observed_path(path):
            if path in (runtime.MOUNT, '/'):
                return SimpleNamespace(stat=lambda: SimpleNamespace(st_dev=2 if path == runtime.MOUNT else 1))
            if path in ('/proc/swaps', '/etc/fstab'): return SimpleNamespace(read_text=lambda: '')
            raise AssertionError('Unexpected live-path observation')
        def existing(path, *_args, **_kwargs):
            if path == '/etc/docker/daemon.json': return SimpleNamespace(read_bytes=lambda: ('{"data-root":"' + c['dockerRoot'] + '"}').encode())
            if path == '/etc/containerd/config.toml': return SimpleNamespace(read_text=lambda: 'root = "' + c['containerdRoot'] + '"')
            return SimpleNamespace(stat=lambda: SimpleNamespace(st_dev=2))
        with patch.object(runtime, 'config_shape'), patch.object(runtime, 'Path', side_effect=observed_path), patch.object(runtime, 'existing', side_effect=existing):
            cmd = FakeCommands(c); runtime.storage_gate(c, cmd)
            self.assertIn('active-containerd-storage', cmd.events)
            cmd.root = '/synthetic/plaintext-old-root'
            with self.assertRaisesRegex(runtime.Hold, 'docker-runtime-root'): runtime.storage_gate(c, cmd)
            cmd.root = c['dockerRoot']; cmd.bad_containerd = True
            with self.assertRaisesRegex(runtime.Hold, 'containerd-active-storage'): runtime.storage_gate(c, cmd)

    def test_containerd_active_database_file_must_match_the_sealed_encrypted_root(self):
        c = config(); process = MagicMock(); proc_root = MagicMock(); proc_root.__truediv__.return_value = process
        files = MagicMock(); descriptor = MagicMock(); files.iterdir.return_value = [descriptor]
        argv = MagicMock(); argv.read_bytes.return_value = b'/usr/bin/containerd\0'
        process.__truediv__.side_effect = lambda name: argv if name == 'cmdline' else files
        real_path = Path
        def paths(path):
            if path == '/proc': return proc_root
            if path == runtime.MOUNT: return SimpleNamespace(stat=lambda: SimpleNamespace(st_dev=2))
            return real_path(path)
        cmd = runtime.Commands.__new__(runtime.Commands); cmd.run = lambda *_args: '321'
        expected = str(Path(c['containerdRoot'])/'io.containerd.metadata.v1.bolt/meta.db')
        with patch.object(runtime, 'Path', side_effect=paths), patch.object(runtime.os, 'readlink', return_value=expected), \
             patch.object(runtime, 'existing', return_value=SimpleNamespace(stat=lambda: SimpleNamespace(st_dev=2))):
            cmd.containerd_storage(c)
            with patch.object(runtime.os, 'readlink', return_value='/synthetic/plaintext/meta.db'):
                with self.assertRaisesRegex(runtime.Hold, 'containerd-active-storage'): cmd.containerd_storage(c)
            with patch.object(runtime, 'existing', return_value=SimpleNamespace(stat=lambda: SimpleNamespace(st_dev=1))):
                with self.assertRaisesRegex(runtime.Hold, 'containerd-active-mount'): cmd.containerd_storage(c)


if __name__ == '__main__': unittest.main()
