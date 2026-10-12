#!/usr/bin/env python3
"""Fixed Surface placement gate. No format, mount, recovery, retry or secret output."""
import argparse
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import stat
import subprocess
import sys
import time
import tomllib
import urllib.parse
import http.client
_periodic_spec = importlib.util.spec_from_file_location('tuat_periodic', Path(__file__).with_name('periodic.py'))
periodic = importlib.util.module_from_spec(_periodic_spec); _periodic_spec.loader.exec_module(periodic)

IMAGES = {
    'db': ('supabase/postgres:17.6.1.136', 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'),
    'auth': ('supabase/gotrue:v2.196.0', 'sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232'),
    'rest': ('postgrest/postgrest:v14.12', 'sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c'),
}
# Image config IDs and registry manifest digests are different identities. These independent
# observed pins happen to have equal hexadecimal bytes in the current cache; never derive one.
REPO_DIGESTS = {
    'db': 'supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00',
    'auth': 'supabase/gotrue@sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232',
    'rest': 'postgrest/postgrest@sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c',
}
PG_COMMAND = ['-D', '/var/lib/postgresql/data', '-c', 'listen_addresses=127.0.0.1', '-c', 'port=18004',
              '-c', 'shared_preload_libraries=', '-c', 'shared_buffers=64MB', '-c', 'max_connections=30']
CONTAINER_EXEC = {'db': (['postgres'], PG_COMMAND), 'auth': (None, ['auth']),
                  'rest': (None, ['/bin/postgrest'])}
TRIALS = tuple('tuat-surface-trial-' + role + '.service' for role in ('adapter', 'app', 'bridge', 'gateway', 'endurance'))
UNITS = ('tuat-local-app.service', 'tuat-local-jobs.service', 'tuat-local-mirror.service') + TRIALS
MOUNT = '/var/lib/tuat-local'
BOOT_CONFIG = '/etc/tuat-local/runtime.json'
CODE_ROOT = Path('/opt/tuat-local-runtime')
COMPOSE_SOURCE = 'ops/local-minimal/surface/compose.yaml'
PATH_KEYS = ('releaseDirectory', 'releaseManifest', 'appEnvironmentFile', 'jobsConfig', 'dbEnvironmentFile',
             'authEnvironmentFile', 'restEnvironmentFile', 'mixedJwks', 'dbData', 'imageRoot', 'jobsStateRoot',
             'dockerRoot', 'containerdRoot', 'privateLogDirectory')
CONFIG_KEYS = {'version', 'installEnabled', 'sourceId', 'mountPoint', 'mapperName', 'luksUuid', 'filesystemUuid',
               'backingFile', 'appUid', 'appGid', 'nodePath', *PATH_KEYS}


class Hold(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Hold(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    with Path(path).open('rb') as data:
        result = hashlib.sha256()
        for chunk in iter(lambda: data.read(1048576), b''):
            result.update(chunk)
        return result.hexdigest()


def existing(path, directory=False, owner=0, mode=None):
    """No symlink in any path component; private inputs are never created."""
    p = Path(path)
    require(p.is_absolute() and '..' not in p.parts, 'path-shape')
    for part in (p, *p.parents):
        require(not part.is_symlink(), 'path-symlink')
        if part != p:
            parent = part.stat()
            require(stat.S_ISDIR(parent.st_mode) and parent.st_uid in ((0, 100) if owner == 100 else (0,)) and
                    not parent.st_mode & 0o022, 'path-ancestor')
    s = p.stat()
    require((stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)) and s.st_uid == owner,
            'path-owner-type')
    require(s.st_nlink == 1 or directory, 'path-hardlink')
    require(stat.S_IMODE(s.st_mode) == mode if mode is not None else not s.st_mode & 0o022, 'path-permissions')
    return p


def private_bytes(path, owner=0, bound=1048576):
    p = existing(path, owner=owner, mode=0o600)
    require(p.stat().st_size <= bound, 'private-size')
    return p.read_bytes()


def app_access(path, directory=False, executable=False):
    """Effective UID/GID1000 access, without granting write access to installed code."""
    p = Path(path)
    for parent in (p.parents if not directory else (p, *p.parents)):
        s = parent.stat(); bits = (s.st_mode >> (6 if s.st_uid == 1000 else 3 if s.st_gid == 1000 else 0)) & 7
        require(bits & 1, 'app-traverse')
    if not directory:
        s = p.stat(); bits = (s.st_mode >> (6 if s.st_uid == 1000 else 3 if s.st_gid == 1000 else 0)) & 7
        require(bits & (1 if executable else 4), 'app-read-execute')


def json_private(path, owner=0, bound=1048576):
    return json.loads(private_bytes(path, owner, bound))


def config_shape(c):
    require(isinstance(c, dict) and set(c) in (CONFIG_KEYS, CONFIG_KEYS | {'backupConfigPath'}) and c['version'] == 1, 'config-contract')
    if 'backupConfigPath' in c:
        require(Path(MOUNT) in Path(c['backupConfigPath']).parents, 'backup-config-path')
    require(type(c['installEnabled']) is bool, 'config-enabled')
    require(c['mountPoint'] == MOUNT and c['mapperName'] == 'tuat-local-data', 'config-mount')
    for key in ('luksUuid', 'filesystemUuid'):
        require(bool(re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', c[key])), 'config-uuid')
    require(c['appUid'] == 1000 and c['appGid'] == 1000, 'config-uid')
    require(c['nodePath'] == '/opt/node-v24.19.0-linux-x64/bin/node', 'config-node')
    require(bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', c['sourceId'])) and
            not c['sourceId'].startswith('REPLACE'), 'config-source')
    for key in PATH_KEYS:
        p = Path(c[key]); require(p.is_absolute() and '..' not in p.parts and Path(MOUNT) in p.parents, 'config-path')
    require(len({c[key] for key in PATH_KEYS}) == len(PATH_KEYS), 'config-path-alias')
    # Existing loop-LUKS backing file is an explicit operator choice, never discovered or created.
    require(c['backingFile'] is None or (isinstance(c['backingFile'], str) and
            Path(c['backingFile']).is_absolute() and 'REPLACE' not in c['backingFile']), 'config-backing')


def env_private(path, owner=0):
    # Deliberately narrow raw env_file contract, identical bytes in Compose and Node.
    # No interpolation, multiline or quoting ambiguity; an unsuitable input is held.
    values = {}
    for line in private_bytes(path, owner).decode('utf8').splitlines():
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=([^\s\x00\x01-\x1f\x7f\'`#]*)', line)
        require(match is not None and match[1] not in values, 'env-encoding')
        require(not match[2].startswith('"'), 'env-quoted-value')
        values[match[1]] = match[2]
    return values


class Commands:
    def __init__(self, private_log):
        self.log = private_log

    def run(self, args, env=None, allowed=(0,), timeout=20):
        # Child output is private in-memory, bounded after collection; no command/exception interpolation.
        # Fixed metadata commands are bounded. App/Jobs streams later go directly to private encrypted log.
        if args[0] == 'docker':
            # Ignore implicit root CLI contexts and remote daemon selection.
            args = ['docker', '--host', 'unix:///var/run/docker.sock', *args[1:]]
        try:
            result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    env=env or {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'}, timeout=timeout, check=False)
        except subprocess.TimeoutExpired as error:
            self.record('timeout', None, len(error.stdout or b''), len(error.stderr or b''))
            raise Hold('child-timeout-or-unavailable') from None
        except OSError:
            self.record('unavailable', None, 0, 0)
            raise Hold('child-timeout-or-unavailable') from None
        self.record('exited', result.returncode, len(result.stdout), len(result.stderr))
        require(len(result.stdout) + len(result.stderr) <= 2 * 1024 ** 2, 'child-output-size')
        require(result.returncode in allowed, 'child-failed')
        return result.stdout.decode('utf8')

    def record(self, event, code, stdout_bytes, stderr_bytes):
        # Metadata diagnostics can contain private values. Keep only non-reversible counts/status,
        # never argv, output, output digests, environment or exception values, even on success.
        entry = {'event': event, 'exit': code, 'stdoutBytes': stdout_bytes, 'stderrBytes': stderr_bytes}
        with self.log.open('ab') as output:
            output.write((json.dumps(entry, separators=(',', ':')) + '\n').encode('ascii'))
            output.flush(); os.fsync(output.fileno())

    def obj(self, args):
        return json.loads(self.run(args))

    def containerd_storage(self, config):
        pid = self.run(['systemctl', 'show', 'containerd.service', '--property=MainPID', '--value']).strip()
        require(re.fullmatch(r'[1-9][0-9]*', pid), 'containerd-process-absent')
        process = Path('/proc') / pid
        argv = (process / 'cmdline').read_bytes().split(b'\0')
        require(argv and argv[0] == b'/usr/bin/containerd' and
                not any(arg.startswith((b'--config', b'--root', b'-c', b'-r')) for arg in argv[1:]), 'containerd-runtime-override')
        descriptors = list((process / 'fd').iterdir())
        require(len(descriptors) <= 4096, 'containerd-fd-bound')
        expected = str(Path(config['containerdRoot']) / 'io.containerd.metadata.v1.bolt/meta.db')
        targets = []
        for descriptor in descriptors:
            try: targets.append(os.readlink(descriptor))
            except FileNotFoundError: continue
        require(expected in targets, 'containerd-active-storage')
        require(existing(expected, owner=0).stat().st_dev == Path(MOUNT).stat().st_dev, 'containerd-active-mount')


def storage_gate(c, cmd):
    config_shape(c)
    require(c['installEnabled'], 'installation-disabled')
    mount = cmd.obj(['findmnt', '--json', '--mountpoint', MOUNT, '-o', 'TARGET,SOURCE,FSTYPE,UUID,OPTIONS'])
    rows = mount.get('filesystems', [])
    require(len(rows) == 1, 'mount-absent')
    m = rows[0]
    require(m.get('target') == MOUNT and m.get('fstype') == 'ext4' and m.get('uuid') == c['filesystemUuid'] and
            'rw' in m.get('options', '').split(',') and
            os.path.realpath(m.get('source', '')) == os.path.realpath('/dev/mapper/' + c['mapperName']), 'mount-identity')
    status = cmd.run(['cryptsetup', 'status', c['mapperName']])
    parts = dict(re.findall(r'^\s+([a-z]+):\s+(.+)$', status, re.M))
    require(parts.get('type') == 'LUKS2' and parts.get('mode') == 'read/write' and parts.get('device', '').startswith('/dev/'),
            'mapper-identity')
    require(cmd.run(['cryptsetup', 'luksUUID', parts['device']]).strip() == c['luksUuid'], 'luks-uuid')
    if c['backingFile'] is not None:
        loop = cmd.obj(['losetup', '--json', '--output', 'NAME,BACK-FILE', parts['device']]).get('loopdevices', [])
        require(len(loop) == 1 and loop[0].get('name') == parts['device'] and
                loop[0].get('back-file') == c['backingFile'], 'luks-backing')
        existing(c['backingFile'], owner=0, mode=0o600)
    require(existing(MOUNT, True).stat().st_dev != Path('/').stat().st_dev, 'mount-plaintext')
    for key in ('dockerRoot', 'containerdRoot'):
        p = existing(c[key], True, mode=0o700)
        require(p.stat().st_dev == Path(MOUNT).stat().st_dev, 'storage-mount')
    daemon = json.loads(existing('/etc/docker/daemon.json').read_bytes())
    containerd = tomllib.loads(existing('/etc/containerd/config.toml').read_text())
    require(daemon.get('data-root') == c['dockerRoot'] and containerd.get('root') == c['containerdRoot'], 'daemon-storage-config')
    require(not containerd.get('imports') and not containerd.get('proxy_plugins'), 'containerd-external-storage')
    def no_plugin_roots(value):
        return all((key not in ('root', 'root_path') and no_plugin_roots(item)) for key, item in value.items()) if isinstance(value, dict) else True
    require(no_plugin_roots(containerd.get('plugins', {})), 'containerd-plugin-storage-override')
    require(not daemon.get('hosts') or daemon['hosts'] == ['unix:///var/run/docker.sock'], 'docker-external-listener')
    # Reject command-line storage/config overrides in the actual daemon unit, including on boot
    # before there is a Docker socket. Default package fd:// + containerd socket options are allowed.
    for unit, forbidden in (('docker.service', ('--data-root', '--config-file', ' -g ', ' -c ')),
                            ('containerd.service', ('--root', '--config', ' -r ', ' -c '))):
        start = cmd.run(['systemctl', 'show', unit, '--property=ExecStart', '--value'])
        require(bool(start.strip()) and '$' not in start and not any(option in start for option in forbidden) and
                not re.search(r'(?:^|\s)-(?:c|r|g)(?:=|\s|;|$)', start), 'daemon-storage-override')
        endpoints = re.findall(r'--containerd(?:=|\s+)([^\s;]+)', start)
        require(not endpoints or endpoints == ['/run/containerd/containerd.sock'], 'daemon-containerd-socket')
        listeners = re.findall(r'(?:--host(?:=|\s+)|-H(?:=|\s*))(\S+)', start)
        require(all(value in ('fd://', 'unix:///var/run/docker.sock') for value in listeners), 'daemon-external-listener')
    # zram is RAM-only; zram writeback or any disk/file swap is held, never disabled automatically.
    for line in Path('/proc/swaps').read_text().splitlines()[1:]:
        columns = line.split()
        require(columns and re.fullmatch(r'/dev/zram[0-9]+', columns[0]), 'plaintext-swap')
        require(Path('/sys/block/' + Path(columns[0]).name + '/backing_dev').read_text().strip() in ('none', ''), 'zram-writeback')
    require(not any(len(line.split()) >= 3 and line.split()[2] == 'swap' for line in
                    Path('/etc/fstab').read_text().splitlines() if line.strip() and not line.lstrip().startswith('#')), 'disk-swap-boot-config')


def decode64(value):
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


def jwt_valid(token, secret, role):
    parts = token.split('.')
    require(len(parts) == 3 and all(re.fullmatch(r'[A-Za-z0-9_-]+', p) for p in parts), 'jwt-shape')
    header, claims = (json.loads(decode64(p)) for p in parts[:2])
    require(header.get('alg') == 'HS256' and claims.get('iss') == 'supabase' and claims.get('role') == role and
            claims.get('aud') == 'authenticated' and type(claims.get('exp')) is int and claims['exp'] > time.time(), 'jwt-claims')
    expected = hmac.new(secret.encode(), (parts[0] + '.' + parts[1]).encode(), hashlib.sha256).digest()
    require(hmac.compare_digest(expected, decode64(parts[2])), 'jwt-key')


def release_inventory(release):
    """Full installed artifact, including Next routes/chunks, all Jobs modules and dependencies."""
    root = existing(release, True)
    device = Path(MOUNT).stat().st_dev
    files, links, total = {}, {}, 0
    for directory, dirs, names in os.walk(root, followlinks=False):
        require(len(files) + len(links) < 200000, 'release-entry-bound')
        for name in dirs + names:
            p = Path(directory) / name; relative = p.relative_to(root).as_posix(); s = p.lstat()
            require(s.st_uid == 0 and s.st_dev == device, 'release-owner-mount')
            if p.is_symlink():
                target = p.resolve(strict=True)
                require(root in target.parents and target.stat().st_dev == device, 'release-link-boundary')
                links[relative] = os.readlink(p)
            elif p.is_dir():
                require(not s.st_mode & 0o022, 'release-directory-writable')
                app_access(p, directory=True)
            else:
                require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and not s.st_mode & 0o022, 'release-file-owner-type')
                total += s.st_size
                require(total <= 4 * 1024 ** 3, 'release-byte-bound')
                app_access(p)
                files[relative] = file_digest(p)
    return {'files': files, 'links': links}


def configuration_gate(c):
    uid = c['appUid']
    # Every private input and release root must actually live on the verified encrypted device;
    # a lexical prefix does not exclude nested plaintext bind mounts.
    device = Path(MOUNT).stat().st_dev
    require(all(Path(c[key]).stat().st_dev == device for key in PATH_KEYS), 'private-input-mount')
    env = env_private(c['appEnvironmentFile'], uid)
    require(not any(key in env for key in ('NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
                'PYTHONPATH', 'PYTHONHOME', 'PATH', 'HOME', 'TMPDIR')), 'env-process-override')
    db, auth, rest = [env_private(c[key]) for key in ('dbEnvironmentFile', 'authEnvironmentFile', 'restEnvironmentFile')]
    for key in ('PC_APP_RUNTIME', 'PC_LOCAL_RUNTIME', 'NEXT_PUBLIC_PC_LOCAL_RUNTIME', 'PC_BACKEND_ENABLED', 'NEXT_PUBLIC_PC_BACKEND'):
        require(env.get(key) == 'true', 'app-runtime')
    require(env.get('PC_APP_READ_ONLY', 'false') == 'false' and env.get('IMAGE_STORAGE_READ_ONLY', 'false') == 'false' and
            env.get('IMAGE_STORAGE_DRIVER') == 'local' and env.get('LOCAL_IMAGE_STORAGE_ROOT') == c['imageRoot'], 'primary-image-contract')
    for key in ('VERCEL', 'VERCEL_ENV', 'PC_BACKEND_INTERNAL_URL', 'NEXT_PUBLIC_PC_REST_RELAY_ORIGIN'):
        require(not env.get(key), 'legacy-routing')
    for key in ('PC_TRIAL_VERCEL', 'NEXT_PUBLIC_PC_TRIAL', 'R2_READ_ENABLED', 'R2_WRITE_ENABLED'):
        require(env.get(key) != 'true', 'legacy-runtime')
    origin = urllib.parse.urlsplit(env.get('APP_PUBLIC_ORIGIN', ''))
    require(origin.scheme == 'https' and origin.netloc and not origin.username and not origin.password and
            not origin.path and not origin.query and not origin.fragment and not origin.port and
            env.get('NEXT_PUBLIC_SUPABASE_URL') == origin.geturl() + '/api/pc-supabase', 'app-origin')
    cloud = env.get('NEXT_PUBLIC_CLOUD_AUTH_URL', '')
    require(re.fullmatch(r'https://[a-z0-9-]+\.supabase\.co', cloud) and
            env.get('NEXT_PUBLIC_CLOUD_AUTH_MODE', 'production') == 'production', 'one-cloud-issuer')
    # The public key pair is also checked by the exact existing Node helper before startup.
    require(env.get('NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY') and env.get('PC_LOCAL_AUTH_URL') == 'http://127.0.0.1:18001' and
            env.get('PC_LOCAL_REST_URL') == 'http://127.0.0.1:18002', 'app-private-targets')
    require(db.get('PGDATA') == '/var/lib/postgresql/data' and db.get('POSTGRES_USER') == 'postgres' and
            re.fullmatch(r'[a-z][a-z0-9_]{0,62}', db.get('POSTGRES_DB', '')) and db.get('POSTGRES_PASSWORD'), 'db-config')
    for name, role, value in (('GOTRUE_DB_DATABASE_URL', 'supabase_auth_admin', auth), ('PGRST_DB_URI', 'authenticator', rest)):
        u = urllib.parse.urlsplit(value.get(name, ''))
        require(u.scheme in ('postgres', 'postgresql') and u.hostname == '127.0.0.1' and u.port == 18004 and
                u.username == role and u.password and u.path == '/' + db['POSTGRES_DB'] and
                (u.query == 'search_path=auth' if role == 'supabase_auth_admin' else not u.query) and not u.fragment,
                'db-uri')
    expected_auth = {'GOTRUE_API_HOST': '127.0.0.1', 'GOTRUE_API_PORT': '18001', 'GOTRUE_DB_DRIVER': 'postgres',
                     'GOTRUE_DB_NAMESPACE': 'auth', 'GOTRUE_JWT_ADMIN_ROLES': 'service_role',
                     'GOTRUE_JWT_AUD': 'authenticated', 'GOTRUE_JWT_DEFAULT_GROUP_NAME': 'authenticated',
                     'GOTRUE_DISABLE_SIGNUP': 'true', 'GOTRUE_EXTERNAL_GOOGLE_ENABLED': 'false',
                     'GOTRUE_SITE_URL': origin.geturl(), 'API_EXTERNAL_URL': origin.geturl() + '/api/pc-supabase/auth/v1'}
    require(all(auth.get(k) == v for k, v in expected_auth.items()), 'private-auth-contract')
    expected_rest = {'PGRST_SERVER_HOST': '127.0.0.1', 'PGRST_SERVER_PORT': '18002', 'PGRST_DB_SCHEMAS': 'public',
                     'PGRST_DB_ANON_ROLE': 'anon', 'PGRST_JWT_SECRET': '@/private/mixed-jwks.json',
                     'PGRST_JWT_AUD': 'authenticated', 'PGRST_DB_PRE_REQUEST': 'public.local_cloud_auth_pre_request',
                     'PGRST_APP_SETTINGS_CLOUD_ISSUER': cloud + '/auth/v1', 'PGRST_APP_SETTINGS_LOCAL_ISSUER': 'supabase'}
    require(all(rest.get(k) == v for k, v in expected_rest.items()), 'rest-auth-hook')
    jwks = json_private(c['mixedJwks'], uid)
    require(set(jwks) == {'keys'} and isinstance(jwks['keys'], list), 'jwks-contract')
    local = [k for k in jwks['keys'] if k.get('kty') == 'oct']
    ec = [k for k in jwks['keys'] if k.get('kty') == 'EC']
    require(len(local) == 1 and len(ec) >= 1 and len(local) + len(ec) == len(jwks['keys']) and
            local[0].get('alg') == 'HS256' and decode64(local[0].get('k', '')).decode() == auth.get('GOTRUE_JWT_SECRET') and
            len(auth.get('GOTRUE_JWT_SECRET', '')) >= 32, 'jwks-local')
    require(all(k.get('crv') == 'P-256' and k.get('alg') == 'ES256' and k.get('kid') and
                not any(p in k for p in ('d', 'p', 'q', 'k')) and len(decode64(k.get('x', ''))) == 32 and
                len(decode64(k.get('y', ''))) == 32 for k in ec), 'jwks-cloud-public')
    kids = [k['kid'] for k in ec]
    require(len(set(kids)) == len(kids) and set(json.loads(rest.get('PGRST_APP_SETTINGS_CLOUD_KIDS', '[]'))) == set(kids), 'jwks-kids')
    jwt_valid(env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY', ''), auth['GOTRUE_JWT_SECRET'], 'anon')
    jwt_valid(env.get('SUPABASE_SERVICE_ROLE_KEY', ''), auth['GOTRUE_JWT_SECRET'], 'service_role')
    require(len(env.get('LOCAL_IMAGE_SIGNING_KEY', '')) >= 32 and env.get('NEXT_SERVER_ACTIONS_ENCRYPTION_KEY'), 'app-signing')
    manifest = json_private(c['releaseManifest'], bound=64 * 1024 ** 2)
    require(manifest.get('version') == 1 and manifest.get('nodeVersion') == 'v24.19.0' and
            re.fullmatch(r'[a-f0-9]{40}', manifest.get('sourceCommit', '')) and
            re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,31}', manifest.get('releaseId', '')) and
            manifest['releaseId'] == env.get('PC_APP_RELEASE_ID') and manifest.get('publicOrigin') == origin.geturl() and
            manifest.get('appEnvironmentSha256') == digest(private_bytes(c['appEnvironmentFile'], uid)) and
            manifest.get('cloudAuthUrl') == cloud and
            manifest.get('cloudAuthPublicKeySha256') == digest(env['NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY'].encode()) and
            manifest.get('actionKeySha256') == digest(env['NEXT_SERVER_ACTIONS_ENCRYPTION_KEY'].encode()), 'release-env')
    release = existing(c['releaseDirectory'], True)
    app_access(release, directory=True)
    required = ('.next/BUILD_ID', '.next/required-server-files.json', 'node_modules/next/dist/bin/next',
                'ops/pc-jobs/run.mjs', 'src/lib/supabase/cloud-auth-config.mjs', '.surface-source-commit', COMPOSE_SOURCE)
    require(isinstance(manifest.get('files'), dict) and set(required).issubset(manifest['files']) and
            isinstance(manifest.get('links'), dict), 'release-files')
    for name in required:
        p = existing(release / name)
        require(digest(p.read_bytes()) == manifest['files'][name], 'release-file-hash')
    require(not any((release / name).exists() for name in ('.env', '.env.local', '.env.production', '.env.production.local',
                '.env.development', '.env.development.local')), 'release-embedded-env')
    actual_inventory = release_inventory(release)
    require(manifest['files'] == actual_inventory['files'] and manifest['links'] == actual_inventory['links'], 'release-inventory')
    require((release / '.surface-source-commit').read_text().strip() == manifest['sourceCommit'] and
            (release / '.next/BUILD_ID').read_text().strip() == manifest.get('buildId') and
            json.loads((release / '.next/required-server-files.json').read_bytes())['config']['deploymentId'] == manifest['releaseId'],
            'release-build')
    jobs = json_private(c['jobsConfig'], uid)
    require(jobs.get('version') == 1 and jobs.get('runtime') == 'shared-local' and type(jobs.get('enabled')) is bool and
            jobs.get('releaseDirectory') == str(release) and jobs.get('stateDirectory') == c['jobsStateRoot'] and
            jobs.get('environmentFile') == c['appEnvironmentFile'] and jobs.get('releaseCommit') == manifest['sourceCommit'] and
            jobs.get('releaseId') == manifest['releaseId'] and jobs.get('appOrigin') == 'http://127.0.0.1:18103' and
            jobs.get('backupSourceId') == c['sourceId'] and Path(MOUNT) in Path(jobs.get('backupStatusFile', '')).parents,
            'jobs-config')
    jobs_backup_gate(c, jobs)
    for key, owner in (('imageRoot', uid), ('jobsStateRoot', uid), ('dbData', 100), ('privateLogDirectory', 0)):
        p = existing(c[key], True, owner, 0o700)
        require(p.stat().st_dev == Path(MOUNT).stat().st_dev, 'data-mount')
    for key in ('imageRoot', 'jobsStateRoot'):
        app_access(c[key], directory=True)
    for key in ('appEnvironmentFile', 'jobsConfig'):
        app_access(c[key])
    require(existing(Path(c['dbData']) / 'PG_VERSION', owner=100).read_text().strip() == '17', 'db-uninitialized')
    compose_gate(c, manifest)
    return env, jobs, manifest


def compose_gate(c, manifest):
    """Bind the installed Docker input to the already validated current app inventory."""
    require(isinstance(manifest, dict) and isinstance(manifest.get('files'), dict), 'compose-source-seal')
    expected = manifest['files'].get(COMPOSE_SOURCE)
    require(isinstance(expected, str) and re.fullmatch(r'[a-f0-9]{64}', expected), 'compose-source-seal')
    source = existing(Path(c['releaseDirectory']) / COMPOSE_SOURCE, mode=0o644)
    require(file_digest(source) == expected, 'compose-source-seal')
    installed = existing(CODE_ROOT / 'compose.yaml', mode=0o644)
    require(file_digest(installed) == expected, 'compose-installed-seal')


def jobs_backup_gate(c, jobs):
    if not c.get('backupConfigPath'): return  # Existing non-periodic placement is unchanged.
    backup=json_private(c['backupConfigPath'])
    require(backup.get('sourceId')==c['sourceId'] and backup.get('writerMode')=='surface-systemd' and
            backup.get('imageRoot')==c['imageRoot'] and backup.get('jobsStateRoot')==c['jobsStateRoot'] and
            backup.get('jobsReceiptFile')==jobs.get('backupStatusFile') and
            (backup.get('periodic') or {}).get('configPath')==c['backupConfigPath'], 'jobs-backup-contract')
    periodic.bind_storage(backup)
    path=Path(backup['jobsReceiptFile'])
    if jobs.get('enabled'):
        require(path.exists(), 'jobs-backup-first-cycle-required')
    if path.exists(): app_access(path)  # Actual UID1000 traverse/read; metadata owner stays root.


def host_gate(c, cmd):
    lines = cmd.run(['systemctl', 'list-units', '--all', '--plain', '--no-legend', 'tuat-*.service'])
    names = [line.split()[0] for line in lines.splitlines() if line.strip()]
    allowed = UNITS + ((periodic.UNIT,) if c.get('backupConfigPath') else ())
    require(len(set(names)) == len(names) and all(name in allowed for name in names), 'unknown-host-unit')
    if periodic.UNIT in names:
        p = existing(c['backupConfigPath'], mode=0o600)
        require(p.stat().st_dev == Path(MOUNT).stat().st_dev, 'backup-config-device')
        backup_config = json.loads(private_bytes(p))
        require(backup_config.get('sourceId') == c['sourceId'], 'backup-config-source')
        periodic.inactive(backup_config, cmd)
    for name in TRIALS + ('tuat-local-mirror.service',):
        text = cmd.run(['systemctl', 'show', name, '--property=LoadState,ActiveState,SubState,FreezerState,MainPID,ControlPID,ControlGroup'], allowed=(0, 1, 4))
        s = dict(line.split('=', 1) for line in text.splitlines() if '=' in line)
        require(s.get('LoadState') in ('loaded', 'not-found') and s.get('ActiveState') == 'inactive' and
                s.get('SubState') == 'dead' and s.get('FreezerState') == 'running' and s.get('MainPID') == '0' and
                s.get('ControlPID') == '0' and s.get('ControlGroup') == '', 'legacy-or-mirror-active')
    require(cmd.run(['docker', 'info', '--format', '{{.DockerRootDir}}']).strip() == c['dockerRoot'], 'docker-runtime-root')
    for role, (tag, pin) in IMAGES.items():
        info = cmd.obj(['docker', 'image', 'inspect', tag, '--format', '{{json .Id}}'])
        digests = cmd.obj(['docker', 'image', 'inspect', tag, '--format', '{{json .RepoDigests}}'])
        require(info == pin and REPO_DIGESTS[role] in digests, 'image-pin')
    # Config file alone cannot prove a previously started daemon loaded the new root.
    # The running existing containerd must have its metadata database open on that device.
    cmd.containerd_storage(c)
    # Only selected metadata: never Docker Config.Env, full inspect or full compose config output.
    owned = {}
    hashes = compose_env(c)
    for ident in cmd.run(['docker', 'ps', '-aq']).split():
        info = cmd.obj(['docker', 'inspect', ident, '--format',
            '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"imageId":{{json .Image}},"labels":{{json .Config.Labels}},"network":{{json .HostConfig.NetworkMode}},"running":{{json .State.Running}},"paused":{{json .State.Paused}},"privileged":{{json .HostConfig.Privileged}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"user":{{json .Config.User}},"entrypoint":{{json .Config.Entrypoint}},"command":{{json .Config.Cmd}},"securityOpt":{{json .HostConfig.SecurityOpt}},"capDrop":{{json .HostConfig.CapDrop}},"capAdd":{{json .HostConfig.CapAdd}},"mounts":{{json .Mounts}}}'])
        own = info['name'] in ['/tuat-local-' + r for r in IMAGES]
        if own:
            role = info['name'].removeprefix('/tuat-local-')
            require(info['image'] == IMAGES[role][0] and info['labels'].get('tuat.local.source') == c['sourceId'] and
                    info['labels'].get('tuat.local.role') == role and info['network'] == 'host' and
                    info['imageId'] == IMAGES[role][1] and not info['paused'] and not info['privileged'] and info['readonly'] and
                    info['user'] == ('100:101' if role == 'db' else '1000:1000') and
                    info['labels'].get('tuat.local.config-sha256') == hashes['TUAT_' + role.upper() + '_HASH'], 'container-identity')
            entrypoint, command = CONTAINER_EXEC[role]
            require(info.get('entrypoint') == entrypoint and info.get('command') == command and
                    info.get('securityOpt') == ['no-new-privileges:true'] and info.get('capDrop') == ['ALL'] and
                    info.get('capAdd') in (None, []),
                    'container-execution-contract')
            mounts = [(m.get('Source'), m.get('Destination'), m.get('RW')) for m in info['mounts'] if m.get('Type') == 'bind']
            expected = {'db': [(c['dbData'], '/var/lib/postgresql/data', True)], 'auth': [],
                        'rest': [(c['mixedJwks'], '/private/mixed-jwks.json', False)]}[role]
            require(sorted(mounts) == sorted(expected) and role not in owned, 'container-mounts')
            if info['running']:
                owned[role] = info['id']
        else:
            protected = any(Path(MOUNT) == Path(m.get('Source', '/')) or Path(MOUNT) in Path(m.get('Source', '/')).parents
                            or Path(m.get('Source', '/')) in Path(MOUNT).parents for m in info['mounts'])
            require(not (info['labels'] or {}).get('tuat.local.source') == c['sourceId'] and
                    not (info['running'] and (info['network'] == 'host' or protected)), 'unknown-container')
    return owned


def compose_env(c):
    return {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'TUAT_SOURCE_ID': c['sourceId'], 'TUAT_DB_ENV': c['dbEnvironmentFile'],
            'TUAT_AUTH_ENV': c['authEnvironmentFile'], 'TUAT_REST_ENV': c['restEnvironmentFile'],
            'TUAT_DB_DATA': c['dbData'], 'TUAT_MIXED_JWKS': c['mixedJwks'],
            'TUAT_DB_HASH': digest(private_bytes(c['dbEnvironmentFile'])),
            'TUAT_AUTH_HASH': digest(private_bytes(c['authEnvironmentFile'])),
            'TUAT_REST_HASH': digest(private_bytes(c['restEnvironmentFile']) + private_bytes(c['mixedJwks'], c['appUid']))}


def ports_gate(owned, cmd):
    text = cmd.run(['ss', '-H', '-ltnp', 'sport = :18103 or sport = :18001 or sport = :18002 or sport = :18004'])
    for line in text.splitlines():
        columns = line.split()
        require(len(columns) >= 5 and columns[3].startswith('127.0.0.1:'), 'port-listener-boundary')
        port = columns[3].split(':')[-1]
        role = {'18004': 'db', '18001': 'auth', '18002': 'rest'}.get(port)
        pids = re.findall(r'pid=([0-9]+)', line)
        require(role in owned and pids, 'runtime-port-busy')
        require(all(owned[role] in Path('/proc/' + pid + '/cgroup').read_text() for pid in pids), 'port-container-owner')


def node_gate(c, env, manifest, cmd):
    node = existing(c['nodePath'])
    app_access(node, executable=True)
    require(re.fullmatch(r'[a-f0-9]{64}', manifest.get('nodeSha256', '')) and
            file_digest(node) == manifest['nodeSha256'] and cmd.run([str(node), '--version']).strip() == 'v24.19.0', 'node-version-pin')
    validate = "import {validateLocalCloudAuthPair as v} from './src/lib/supabase/cloud-auth-config.mjs';v(process.env.NEXT_PUBLIC_CLOUD_AUTH_URL,process.env.NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY,process.env.NEXT_PUBLIC_CLOUD_AUTH_MODE);"
    previous = Path.cwd(); os.chdir(c['releaseDirectory'])
    try:
        public = {key: env[key] for key in ('NEXT_PUBLIC_CLOUD_AUTH_URL', 'NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY')}
        public['NEXT_PUBLIC_CLOUD_AUTH_MODE'] = env.get('NEXT_PUBLIC_CLOUD_AUTH_MODE', 'production')
        cmd.run([str(node), '--input-type=module', '-e', validate], env={**public, 'PATH': '/usr/bin:/bin'})
    finally:
        os.chdir(previous)


def wait_primary(env, pause=time.sleep, connection_factory=http.client.HTTPConnection, attempts=60):
    """Cookie-free startup probes only. Cold boot can precede Next's listener, no job dispatch."""
    for attempt in range(attempts):
        health, status = {}, None
        connection = connection_factory('127.0.0.1', 18103, timeout=3)
        try:
            connection.request('GET', '/api/version', headers={'Host': urllib.parse.urlsplit(env['APP_PUBLIC_ORIGIN']).netloc})
            response = connection.getresponse(); body = response.read(4097); status = response.status
            health = json.loads(body) if len(body) <= 4096 else {}
            require(isinstance(health, dict), 'primary-health-shape')
        except (OSError, ValueError, http.client.HTTPException):
            health = {}
        finally:
            connection.close()
        require(not health.get('version') or health['version'] == env['PC_APP_RELEASE_ID'], 'primary-release-mismatch')
        require(health.get('readOnly') is not True and health.get('dbReadOnly') is not True, 'primary-read-only')
        if status == 200 and health.get('version') == env['PC_APP_RELEASE_ID'] and health.get('ready') is True and \
           health.get('readOnly') is False and health.get('dbReadOnly') is False:
            return
        if attempt + 1 < attempts:
            pause(2)
    raise Hold('primary-readiness')


def exec_runtime(c, mode, env, jobs, cmd, owned, manifest=None):
    require(mode != '--jobs' or jobs['enabled'], 'jobs-disabled')
    node = existing(c['nodePath'])
    release = Path(c['releaseDirectory'])
    if mode == '--app':
        compose_gate(c, manifest)
        # Refuse busy ports before ever starting/recreating containers. Existing exact owned containers
        # are deliberately not restarted automatically; bring them down only after operator review.
        ports_gate(owned, cmd)
        cmd.run(['docker', 'compose', '-f', str(CODE_ROOT / 'compose.yaml'), '--project-name', 'tuat-local', 'config', '--quiet'], compose_env(c))
        cmd.run(['docker', 'compose', '-f', str(CODE_ROOT / 'compose.yaml'), '--project-name', 'tuat-local', 'up', '-d', '--pull', 'never', '--no-build', '--no-recreate'], compose_env(c), timeout=90)
        started = host_gate(c, cmd)
        require(set(started) == set(IMAGES), 'container-start-unverified')
        # Reused containers are checked again after starting. Refuse a newly exposed/non-owned
        # listener before probing DB readiness or executing the application/Jobs.
        ports_gate(started, cmd)
        # A migration/restore must have installed the pre-request hook before this point.
        ready = False
        for _ in range(30):
            try:
                response = http.client.HTTPConnection('127.0.0.1', 18002, timeout=2)
                response.request('GET', '/rpc/backup_read_only', headers={'Authorization': 'Bearer ' + env['NEXT_PUBLIC_SUPABASE_ANON_KEY'], 'apikey': env['NEXT_PUBLIC_SUPABASE_ANON_KEY']})
                result = response.getresponse(); data = result.read(4097)
                ready = result.status == 200 and len(data) <= 4096 and json.loads(data) is False
                response.close()
            except (OSError, ValueError):
                ready = False
            if ready:
                break
            time.sleep(1)
        require(ready, 'primary-db-not-writable-ready')
        args = [str(node), str(release / 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '18103']
    else:
        wait_primary(env, connection_factory=http.client.HTTPConnection)
        # Existing Jobs validates release/env/receipt and readiness; no child app and no second writer.
        args = [str(node), str(release / 'ops/pc-jobs/run.mjs'), '--run', c['jobsConfig']]
    logfile = existing(c['privateLogDirectory'], True, mode=0o700) / ('app.log' if mode == '--app' else 'jobs.log')
    fd = os.open(logfile, os.O_CREAT | os.O_APPEND | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    require(os.fstat(fd).st_uid == 0 and stat.S_IMODE(os.fstat(fd).st_mode) == 0o600 and os.fstat(fd).st_nlink == 1, 'runtime-log')
    os.dup2(fd, 1); os.dup2(fd, 2); os.close(fd)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0)); os.umask(0o077)
    os.setgroups([]); os.setgid(c['appGid']); os.setuid(c['appUid']); os.chdir(release)
    require(os.getuid() == 1000 and os.getgid() == 1000 and not os.getgroups(), 'drop-privileges')
    child_env = {**env, 'NODE_ENV': 'production', 'PATH': '/opt/node-v24.19.0-linux-x64/bin:/usr/bin:/bin',
                 'HOME': c['jobsStateRoot'], 'TMPDIR': '/tmp', 'NEXT_TELEMETRY_DISABLED': '1'}
    os.execve(str(node), args, child_env)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Fixed Surface runtime gate; default disabled.')
    group = parser.add_mutually_exclusive_group(required=True)
    for mode in ('--storage-only', '--check', '--app', '--jobs'):
        group.add_argument(mode, action='store_const', const=mode, dest='mode')
    parser.add_argument('config')
    args = parser.parse_args(argv)
    try:
        require(sys.platform == 'linux' and os.getuid() == 0, 'linux-root-required')
        require(args.config == BOOT_CONFIG, 'bootstrap-path')
        c = json_private(args.config)
        # /run is volatile RAM. No raw diagnostics are persisted on the plaintext root filesystem.
        check = subprocess.run(['findmnt', '-n', '-o', 'FSTYPE', '-T', '/run'], capture_output=True, timeout=3)
        require(check.returncode == 0 and check.stdout.strip() == b'tmpfs', 'volatile-log-storage')
        logdir = Path('/run/tuat-local-runtime')
        if not logdir.exists():
            logdir.mkdir(mode=0o700)
        existing(logdir, True, mode=0o700)
        log = logdir / 'preflight.log'
        descriptor = os.open(log, os.O_CREAT | os.O_APPEND | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        require(os.fstat(descriptor).st_uid == 0 and stat.S_IMODE(os.fstat(descriptor).st_mode) == 0o600 and
                os.fstat(descriptor).st_nlink == 1, 'preflight-log')
        os.close(descriptor)
        cmd = Commands(log)
        storage_gate(c, cmd)
        if args.mode == '--storage-only':
            print('{"valid":true,"scope":"encrypted-storage-only"}')
            return 0
        env, jobs, manifest = configuration_gate(c)
        node_gate(c, env, manifest, cmd)
        owned = host_gate(c, cmd)
        if args.mode == '--check':
            print(json.dumps({'valid': True, 'scope': 'placement', 'jobsEnabled': jobs['enabled']}))
            return 0
        exec_runtime(c, args.mode, env, jobs, cmd, owned, manifest)
    except Hold as error:
        print(json.dumps({'valid': False, 'hold': str(error)}))
        return 1
    except Exception:
        # Never stringify private values, command failures or unexpected library exception details.
        print('{"valid":false,"hold":"unverified-input-or-runtime"}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
