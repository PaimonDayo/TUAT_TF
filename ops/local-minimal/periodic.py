"""Root oneshot policy. No daemon, endpoint discovery, replay, retention deletion or key logging."""
from contextlib import contextmanager
import datetime as dt
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import time
import urllib.parse

UNIT = 'tuat-local-backup.service'
TIMER = 'tuat-local-backup.timer'
SOCKET = 'unix:///var/run/docker.sock'
PC_PROFILE = 'pc-private'
PC_DAEMONS = ('tuat-local-docker.service', 'tuat-local-containerd.service')

def installation_profile(config):
    name = config.get('profile', 'surface')
    need(name in ('surface', PC_PROFILE), 'placement-profile')
    if name == 'surface':
        return {'name': name, 'socket': SOCKET, 'dockerUnit': 'docker.service', 'containerdUnit': 'containerd.service',
                'dockerConfig': '/etc/docker/daemon.json', 'containerdConfig': '/etc/containerd/config.toml',
                'containerdSocket': '/run/containerd/containerd.sock', 'appPort': 18103, 'authPort': 18001, 'restPort': 18002, 'dbPort': 18004,
                'composeSource': 'ops/local-minimal/surface/compose.yaml', 'composeInstalled': '/opt/tuat-local-runtime/compose.yaml'}
    return {'name': name, 'socket': 'unix:///run/tuat-local/docker.sock', 'dockerUnit': PC_DAEMONS[0], 'containerdUnit': PC_DAEMONS[1],
            'dockerConfig': '/etc/tuat-local/docker.json', 'containerdConfig': '/etc/tuat-local/containerd.toml',
            'containerdSocket': '/run/tuat-local/containerd/containerd.sock', 'appPort': 18200, 'authPort': 18301, 'restPort': 18302, 'dbPort': 18304,
            'composeSource': 'ops/local-minimal/pc/compose.yaml', 'composeInstalled': '/opt/tuat-local-runtime/compose.pc.yaml'}

def daemon_argv(profile, kind):
    if kind == 'docker':
        return ['/usr/bin/dockerd', '--config-file=' + profile['dockerConfig']]
    return ['/usr/bin/containerd', '--config', profile['containerdConfig']]
MOUNT = Path('/var/lib/tuat-local')
FIELDS = 'LoadState,Type,ActiveState,SubState,FreezerState,MainPID,ControlPID,ControlGroup,InvocationID,ExecMainStartTimestampMonotonic,FragmentPath,DropInPaths,ExecStart'
LIMITS = {'maxArchiveBytes': (1048576, 16*1024**3), 'maxTotalArchiveBytes': (1048576, 64*1024**3),
          'maxArchives': (1, 10000), 'reserveBytes': (1048576, 64*1024**3),
          'reserveInodes': (100, 1000000), 'minAvailableBytes': (1048576, 8*1024**3),
          'maxCycleSeconds': (1, 1800)}

class Hold(RuntimeError):
    pass

def need(value, reason):
    if not value:
        raise Hold(reason)

def finite(value):
    return type(value) in (int, float) and math.isfinite(value)

def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            value.update(block)
    return value.hexdigest()

def immutable(path, private=False):
    p = Path(path)
    need(p.is_absolute() and '..' not in p.parts and p.resolve() == p, 'periodic-immutable-path')
    for parent in p.parents:
        s = parent.stat()
        need(s.st_uid == 0 and stat.S_ISDIR(s.st_mode) and not s.st_mode & 0o022, 'periodic-immutable-parent')
    s = p.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and s.st_nlink == 1 and
         (stat.S_IMODE(s.st_mode) == 0o600 if private else not s.st_mode & 0o022), 'periodic-immutable-file')
    return p

def read_json(path, private=True, bound=1048576):
    p = immutable(path, private)
    need(p.stat().st_size <= bound, 'periodic-metadata-bound')
    value = json.loads(p.read_bytes())
    need(isinstance(value, dict), 'periodic-metadata-shape')
    return value

def policy(config):
    value = config.get('periodic')
    if value is None:
        return None
    need(isinstance(value, dict) and type(value.get('enabled')) is bool, 'periodic-policy')
    need(set(value) == {'enabled', 'controlSeal', 'configPath', 'allowUntil', *LIMITS}, 'periodic-policy-keys')
    for name, (lower, upper) in LIMITS.items():
        need(type(value[name]) is int and lower <= value[name] <= upper, 'periodic-policy-bound')
    need(value['maxTotalArchiveBytes'] >= value['maxArchiveBytes'] + 36, 'periodic-retention-budget')
    for name in ('controlSeal', 'configPath'):
        need(isinstance(value[name], str) and Path(value[name]).is_absolute(), 'periodic-policy-path')
    until = dt.datetime.fromisoformat(value['allowUntil'])
    need(until.tzinfo is not None, 'periodic-horizon')
    return value

def properties(commands):
    text = commands.run(['systemctl', 'show', UNIT, '--property=' + FIELDS])
    if isinstance(text, bytes): text = text.decode()
    need(len(text) <= 16384, 'periodic-systemd-bound')
    pairs = [line.split('=', 1) for line in text.splitlines() if '=' in line]
    need(len({p[0] for p in pairs}) == len(pairs), 'periodic-systemd-duplicates')
    return dict(pairs)

def seal(config):
    p = policy(config)
    need(p is not None, 'periodic-policy-required')
    value = read_json(p['controlSeal'])
    pc = installation_profile(config)['name'] == PC_PROFILE
    need(set(value) == {'version', 'sourceId', 'sourceCommit', 'configSha256', 'sources', 'fragment',
                        'fragmentSha256', 'timer', 'timerSha256', 'execStart', 'nodePath', 'nodeSha256',
                        'runtimeConfigPath', 'runtimeConfigSha256', *({'offsiteInputs'} if pc else set())}, 'periodic-seal-keys')
    need(value['version'] == 1 and value['sourceId'] == config['sourceId'] and
         bool(re.fullmatch('[a-f0-9]{40}', value['sourceCommit'])), 'periodic-source-pin')
    need(digest(immutable(p['configPath'], True)) == value['configSha256'] and
         read_json(p['configPath']) == config, 'periodic-config-pin')
    required = {'backup.py', 'backup-codec.mjs', 'runtime.py', 'periodic.py'}
    if pc: required |= {'offsite.mjs', 'pc-backup/config.mjs', 'pc-backup/status.mjs', 'pc-backup/application-status.mjs'}
    need(isinstance(value['sources'], dict) and set(value['sources']) == required, 'periodic-source-set')
    base = Path(__file__).resolve().parent
    actual = {'backup.py': base / 'backup.py', 'backup-codec.mjs': base / 'backup-codec.mjs',
              'runtime.py': base / 'runtime.py', 'periodic.py': base / 'periodic.py'}
    if pc:
        actual.update({'offsite.mjs': base/'offsite.mjs', **{name:base.parent/name for name in required if name.startswith('pc-backup/')}})
    for name, record in value['sources'].items():
        need(isinstance(record, dict) and set(record) == {'path', 'sha256'} and
             Path(record['path']) == actual[name] and digest(immutable(record['path'])) == record['sha256'], 'periodic-code-pin')
    for prefix in ('fragment', 'timer', 'nodePath', 'runtimeConfigPath'):
        hash_key = {'nodePath': 'nodeSha256', 'runtimeConfigPath': 'runtimeConfigSha256'}.get(prefix, prefix + 'Sha256')
        need(digest(immutable(value[prefix], prefix == 'runtimeConfigPath')) == value[hash_key], 'periodic-install-pin')
    runtime = read_json(value['runtimeConfigPath'])
    need(installation_profile(config)['name'] == installation_profile(runtime)['name'], 'periodic-profile-binding')
    need(Path(value['fragment']).name == UNIT and Path(value['timer']).name == TIMER and
         value['nodePath'] == '/opt/node-v24.19.0-linux-x64/bin/node', 'periodic-fixed-install')
    expected = '/usr/bin/python3 -I ' + str(actual['backup.py']) + ' --config ' + p['configPath'] + ' --execute'
    need(value['execStart'] == expected, 'periodic-exec-pin')
    if pc: pc_offsite_inputs(config, value, runtime)
    return value


def pc_offsite_inputs(config, installed, runtime=None):
    """Private inputs and sender bytes have one existing seal, never an ambient endpoint."""
    runtime = runtime or read_json(installed['runtimeConfigPath'])
    need(installation_profile(runtime)['name'] == PC_PROFILE and runtime.get('sourceId') == config['sourceId'], 'periodic-offsite-runtime')
    paths = {'offsiteConfigPath': runtime.get('offsiteConfigPath'), 'hostConfigPath': runtime.get('hostConfigPath'),
             'releaseManifest': runtime.get('releaseManifest')}
    inputs = installed.get('offsiteInputs')
    need(isinstance(inputs, dict) and set(inputs) == {*paths, 'nodeBackupConfigPath', 'offsiteEnvironmentPath'}, 'periodic-offsite-inputs')
    def pinned(key, path):
        record = inputs[key]
        need(isinstance(record, dict) and set(record) == {'path', 'sha256'} and record['path'] == path and
             isinstance(path, str) and MOUNT in Path(path).parents and
             re.fullmatch('[a-f0-9]{64}', record['sha256'] or '') is not None, 'periodic-offsite-input-pin')
        file = immutable(path, True)
        need(file.stat().st_dev == MOUNT.stat().st_dev and digest(file) == record['sha256'], 'periodic-offsite-input-bytes')
        return file
    for key, path in paths.items(): pinned(key, path)
    host, offsite = read_json(paths['hostConfigPath']), read_json(paths['offsiteConfigPath'])
    paths['nodeBackupConfigPath'] = host.get('backupConfigFile')
    pinned('nodeBackupConfigPath', paths['nodeBackupConfigPath'])
    backup = read_json(paths['nodeBackupConfigPath'])
    paths['offsiteEnvironmentPath'] = backup.get('environmentFile')
    pinned('offsiteEnvironmentPath', paths['offsiteEnvironmentPath'])
    need(backup.get('profile') == PC_PROFILE and backup.get('instanceId') == config['sourceId'] and
         backup.get('executionMode') == 'linux' and backup.get('dockerSocket') == installation_profile(config)['socket'] and
         backup.get('localImageRoot') == config['imageRoot'] == '/var/lib/tuat-local/images' and
         offsite.get('profile') == PC_PROFILE and offsite.get('sourceId') == config['sourceId'] and
         offsite.get('hostConfigFile') == paths['hostConfigPath'] and offsite.get('producerReceiptFile') == config['receiptFile'] and
         offsite.get('environmentFile') == paths['offsiteEnvironmentPath'] and offsite.get('imageRoot') == config['imageRoot'] and
         isinstance(offsite.get('stateDirectory'), str) and MOUNT in Path(offsite['stateDirectory']).parents and
         backup.get('localSnapshotReceiptFile') == str(Path(offsite['stateDirectory'])/'local-snapshot.json') and
         offsite.get('databaseSystemIdentifier') == (backup.get('target') or {}).get('databaseSystemIdentifier') == host.get('expectedBackupDatabaseSystemIdentifier') and
         host.get('expectedBackupInstanceId') == config['sourceId'] and
         host.get('expectedBackupDatabaseName') == (backup.get('target') or {}).get('databaseName') == config['database'], 'periodic-offsite-binding')
    manifest = read_json(paths['releaseManifest'], bound=64*1024**2)
    need(runtime.get('releaseDirectory') == str(Path(__file__).resolve().parents[2]) and
         manifest.get('sourceCommit') == installed['sourceCommit'] and
         manifest.get('nodeBackupConfigSha256') == inputs['nodeBackupConfigPath']['sha256'] and
         manifest.get('offsiteConfigPathSha256') == inputs['offsiteConfigPath']['sha256'] and
         manifest.get('offsiteEnvironmentSha256') == inputs['offsiteEnvironmentPath']['sha256'], 'periodic-offsite-manifest')
    return runtime, offsite, manifest


def sender_inventory(runtime, installed, manifest):
    """Reuse the complete installed release inventory, including SDK dependency bytes."""
    spec = importlib.util.spec_from_file_location('tuat_offsite_runtime', installed['sources']['runtime.py']['path'])
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    need(module.release_inventory(runtime['releaseDirectory'], runtime['appUid'], runtime['appGid']) ==
         {'files': manifest['files'], 'links': manifest['links']}, 'periodic-offsite-sender-inventory')


def actor(config):
    """Reader identity comes only from the protected runtime config bound by the seal."""
    installed = seal(config)
    runtime = read_json(installed['runtimeConfigPath'])
    need(runtime.get('sourceId') == config['sourceId'] and
         all(type(runtime.get(key)) is int and 1000 <= runtime[key] < 2**32-1 for key in ('appUid', 'appGid')),
         'periodic-actor-identity')
    need(type(config.get('sourceOwnerUid')) is int and config['sourceOwnerUid'] == runtime['appUid'], 'periodic-source-owner')
    return runtime['appUid'], runtime['appGid']


def placement(config):
    selected = installation_profile(config)
    if selected['name'] == PC_PROFILE:
        installed = seal(config)
        runtime = read_json(installed['runtimeConfigPath'])
        need(runtime.get('sourceId') == config['sourceId'] and installation_profile(runtime) == selected, 'periodic-profile-binding')
        pc_database(config, runtime)
    return selected


def pc_database(config, runtime=None):
    """Bind the producer's selected database before any source SQL or dump."""
    if installation_profile(config)['name'] != PC_PROFILE:
        return
    if runtime is None:
        installed = seal(config)
        runtime = read_json(installed['runtimeConfigPath'])
    need(runtime.get('sourceId') == config['sourceId'] and installation_profile(runtime)['name'] == PC_PROFILE,
         'periodic-database-runtime')
    environments = []
    for key in ('dbEnvironmentFile', 'authEnvironmentFile', 'restEnvironmentFile'):
        name = runtime.get(key)
        need(isinstance(name, str) and MOUNT in Path(name).parents, 'periodic-database-env-path')
        path = immutable(name, True)
        need(path.stat().st_dev == MOUNT.stat().st_dev and path.stat().st_size <= 1048576, 'periodic-database-env-bound')
        values = {}
        for line in path.read_bytes().decode('utf8').splitlines():
            if not line or line.startswith('#'): continue
            match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=([^\s\x00\x01-\x1f\x7f\'`#]*)', line)
            need(match is not None and match[1] not in values and not match[2].startswith('"'), 'periodic-database-env-encoding')
            values[match[1]] = match[2]
        environments.append(values)
    db, auth, rest = environments
    need(isinstance(config.get('database'), str) and re.fullmatch('[a-z][a-z0-9_]{0,62}', config['database']) and
         db.get('POSTGRES_DB') == config['database'] and db.get('PGDATA') == '/var/lib/postgresql/data' and
         db.get('POSTGRES_USER') == 'postgres' and db.get('POSTGRES_PASSWORD') and 'POSTGRES_HOST_AUTH_METHOD' not in db,
         'periodic-database-binding')
    for key, role, env in (('GOTRUE_DB_DATABASE_URL', 'supabase_auth_admin', auth), ('PGRST_DB_URI', 'authenticator', rest)):
        uri = urllib.parse.urlsplit(env.get(key, ''))
        need(uri.scheme in ('postgres', 'postgresql') and uri.hostname == '127.0.0.1' and uri.port == 18304 and
             uri.username == role and uri.password and uri.path == '/'+config['database'] and
             (uri.query == 'search_path=auth' if role == 'supabase_auth_admin' else not uri.query) and not uri.fragment,
             'periodic-database-uri')

def inactive(config, commands):
    """Runtime admits a known installed but idle controller, never an active one."""
    s = properties(commands)
    need(s.get('LoadState') in ('loaded', 'not-found') and s.get('ActiveState') == 'inactive' and
         s.get('SubState') == 'dead' and s.get('FreezerState') == 'running' and
         s.get('MainPID') == '0' and s.get('ControlPID') == '0' and s.get('ControlGroup') == '', 'periodic-active-at-runtime-start')
    if s['LoadState'] == 'loaded':
        installed = seal(config)
        need(s.get('FragmentPath') == installed['fragment'] and s.get('DropInPaths') == '' and
             s.get('Type') == 'oneshot', 'periodic-inactive-fragment')
    return {k: s.get(k) for k in ('LoadState','ActiveState','SubState','MainPID','ControlPID','ControlGroup')}

def verify_self(config, commands, prior=None, resume=False):
    installed = seal(config)
    s = properties(commands)
    phase_ok = s.get('ActiveState') == 'activating' and s.get('SubState') == 'start'
    if resume:
        phase_ok |= s.get('ActiveState') == 'deactivating' and s.get('SubState') == 'stop-sigterm'
    need(os.geteuid() == 0 and s.get('LoadState') == 'loaded' and s.get('Type') == 'oneshot' and phase_ok and
         s.get('FreezerState') == 'running' and s.get('MainPID') == str(os.getpid()) and s.get('ControlPID') == '0', 'periodic-controller-state')
    group = Path('/proc/self/cgroup').read_text().splitlines()
    need(len(group) == 1 and group[0].startswith('0::'), 'periodic-cgroup-v2')
    group = group[0][3:]
    need(group == s.get('ControlGroup') and group.endswith('/' + UNIT) and
         not any(name in group for name in ('tuat-local-jobs.service','tuat-local-app.service')), 'periodic-controller-cgroup')
    pid_stat = Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()
    ticks = int(pid_stat[19]); birth_us = ticks * 1000000 // os.sysconf('SC_CLK_TCK')
    start_us = int(s.get('ExecMainStartTimestampMonotonic', '0'))
    need(start_us > 0 and abs(birth_us - start_us) <= 2000000, 'periodic-controller-birth')
    invocation = s.get('InvocationID', '')
    need(bool(re.fullmatch('[a-f0-9]{32}', invocation)), 'periodic-controller-invocation')
    env = Path('/proc/self/environ').read_bytes().split(b'\x00')
    need([v for v in env if v.startswith(b'INVOCATION_ID=')] == [b'INVOCATION_ID=' + invocation.encode()], 'periodic-controller-invocation-binding')
    argv = Path('/proc/self/cmdline').read_bytes().split(b'\x00')[:-1]
    need(argv == [b'/usr/bin/python3', b'-I', str(Path(__file__).parent / 'backup.py').encode(),
                  b'--config', policy(config)['configPath'].encode(), b'--execute'], 'periodic-controller-argv')
    need(s.get('FragmentPath') == installed['fragment'] and s.get('DropInPaths') == '' and
         installed['execStart'] in s.get('ExecStart', ''), 'periodic-controller-fragment')
    identity = {'pid': os.getpid(), 'birthTicks': ticks, 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                'invocationId': invocation, 'controlGroup': group, 'sourceId': config['sourceId'],
                'configSha256': installed['configSha256'], 'fragmentSha256': installed['fragmentSha256']}
    need(prior is None or prior == identity, 'periodic-controller-identity-changed')
    return identity

def bind_storage(config):
    """Bind every private capture path to the SAME runtime-verified mount, not any shared device.
    Called after the actual storage-only gate and during capacity/output checks. Recovery copy
    and the immutable /etc runtime bootstrap are intentionally outside this data contract.
    """
    _, actor_gid = actor(config)
    m = MOUNT.lstat()
    need(stat.S_ISDIR(m.st_mode) and m.st_uid == 0 and not m.st_mode & 0o022 and
         MOUNT.resolve() == MOUNT and m.st_dev != Path('/').stat().st_dev, 'periodic-encrypted-mount')
    raw = Path('/proc/self/mountinfo').read_bytes()
    need(len(raw) <= 8*1024**2, 'periodic-mount-inventory-bound')
    points=[]
    for row in raw.decode().splitlines():
        fields=row.split(' ')
        need(len(fields)>=10 and ' - ' in row, 'periodic-mount-inventory')
        target=fields[4]
        for a,b in ((r'\040',' '),(r'\011','\t'),(r'\012','\n'),(r'\134','\\')):target=target.replace(a,b)
        points.append(Path(target))
    need(points.count(MOUNT)==1 and not any(MOUNT in p.parents for p in points), 'periodic-nested-mount')
    p=policy(config)
    paths=[(config[k], k in ('imageRoot','jobsStateRoot','backupRoot','stageRoot'))
           for k in ('imageRoot','jobsStateRoot','backupRoot','stageRoot','runtimeKey','receiptFile')]
    paths += [(p['configPath'],False),(p['controlSeal'],False)]
    jobs=Path(config['jobsReceiptFile']);meta=jobs.parent
    need(meta!=Path(config['backupRoot']) and MOUNT in meta.parents and meta.resolve()==meta,
         'periodic-jobs-metadata-path')
    ms=meta.lstat()
    need(stat.S_ISDIR(ms.st_mode) and ms.st_uid==0 and ms.st_gid==actor_gid and
         stat.S_IMODE(ms.st_mode)==0o750 and ms.st_dev==m.st_dev, 'periodic-jobs-metadata-owner')
    paths += [(str(jobs),False)]
    for text,is_dir in paths:
        path=Path(text)
        need(path.is_absolute() and '..' not in path.parts and MOUNT in path.parents and path.resolve()==path,
             'periodic-private-mount-path')
        for part in (path,*path.parents):
            if part==MOUNT:break
            if not part.exists() and part==path and text in (config['receiptFile'],config['jobsReceiptFile']):continue
            s=part.lstat()
            need(not stat.S_ISLNK(s.st_mode) and s.st_dev==m.st_dev, 'periodic-private-mount-device')
        if not path.exists():
            need(text in (config['receiptFile'],config['jobsReceiptFile']), 'periodic-private-mount-missing')
            continue
        s=path.lstat()
        need(stat.S_ISDIR(s.st_mode) if is_dir else stat.S_ISREG(s.st_mode), 'periodic-private-mount-type')
        if text not in (config['imageRoot'],config['jobsStateRoot']):
            need(s.st_uid==0 and stat.S_IMODE(s.st_mode)==(0o700 if is_dir else 0o640 if text==config['jobsReceiptFile'] else 0o600) and
                 (is_dir or s.st_nlink==1), 'periodic-private-mount-owner')
            if text==config['jobsReceiptFile']:need(s.st_gid==actor_gid, 'periodic-jobs-receipt-group')
            # Root-private config/key/receipt cannot be swapped by an app-writable ancestor.
            for ancestor in path.parents:
                if ancestor==MOUNT:break
                a=ancestor.stat()
                need(a.st_uid==0 and not a.st_mode & 0o022, 'periodic-private-mount-parent')

def capacity(config, archive_bytes=None):
    p = policy(config)
    need(p['enabled'], 'periodic-disabled')
    bind_storage(config)
    need(dt.datetime.now(dt.timezone.utc) < dt.datetime.fromisoformat(p['allowUntil']), 'periodic-horizon-expired')
    roots = [Path(config[k]) for k in ('backupRoot','stageRoot','imageRoot','jobsStateRoot')]
    devices = {r.stat().st_dev for r in roots}
    need(len(devices) == 1, 'periodic-storage-device')
    budget = p['maxArchiveBytes'] if archive_bytes is None else archive_bytes
    need(0 <= budget <= p['maxArchiveBytes'], 'periodic-output-bound')
    for root in roots[:2]:
        fs = os.statvfs(root)
        need(fs.f_bavail * fs.f_frsize >= 5 * budget + 32*1048576 + p['reserveBytes'] and
             fs.f_favail >= p['reserveInodes'] + 100, 'periodic-storage-capacity')
    available = next(int(row.split()[1])*1024 for row in Path('/proc/meminfo').read_text().splitlines() if row.startswith('MemAvailable:'))
    need(available >= p['minAvailableBytes'], 'periodic-memory-capacity')
    total, count = 0, 0
    for child in roots[0].iterdir():
        if child.name.startswith('snapshot-') and child.name.endswith('.tar.enc'):
            info = child.lstat()
            need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and
                 stat.S_IMODE(info.st_mode) == 0o600, 'periodic-archive-inventory')
            total += info.st_size; count += 1
        elif child.name not in ('backup.lock', 'capture-state.json', 'periodic-attempt.json', Path(config['receiptFile']).name):
            raise Hold('periodic-unknown-backup-file')
    adding = archive_bytes is None
    need(count + int(adding) <= p['maxArchives'] and total + (p['maxArchiveBytes'] + 36 if adding else 0)
         <= p['maxTotalArchiveBytes'], 'periodic-retention-capacity')
    return {'freeBytes': min(os.statvfs(r).f_bavail * os.statvfs(r).f_frsize for r in roots[:2]),
            'archiveCount': count, 'archiveBytes': total, 'availableBytes': available}

class Attempt:
    """Constructed only inside the existing producer flock; unfinished attempts never replay."""
    def __init__(self, config, commands, atomic_json, file_hash, jobs_write=None):
        self.config, self.commands, self.write, self.hash = config, commands, atomic_json, file_hash
        self.jobs_write=jobs_write
        p = policy(config)
        need(p['enabled'], 'periodic-disabled')
        self.identity = verify_self(config, commands)
        commands.storage_gate(config)  # Reuse the immutable placement storage-only gate; no LUKS bypass.
        self.path = Path(config['backupRoot']) / 'periodic-attempt.json'
        if self.path.exists():
            prior = read_json(self.path)
            need(prior.get('version') == 1 and prior.get('sourceId') == config['sourceId'] and
                 prior.get('phase') in ('verified','refused') and finite(prior.get('finishedAt')), 'periodic-prior-unknown-hold')
            if prior['phase'] == 'verified':
                receipt = Path(config['receiptFile'])
                need(receipt.exists() and prior.get('receiptHash') == self.hash(receipt), 'periodic-prior-publication-unknown')
                jobs=Path(config['jobsReceiptFile'])
                need(jobs.exists() and prior.get('jobsReceiptHash')==self.hash(jobs), 'periodic-prior-jobs-publication-unknown')
                if installation_profile(config)['name'] == PC_PROFILE:
                    installed = seal(config)
                    _, offsite, _ = pc_offsite_inputs(config, installed)
                    node_receipt = str(Path(offsite['stateDirectory'])/'local-snapshot.json')
                    need(prior.get('offsiteReceiptPath') == node_receipt and
                         prior.get('offsiteReceiptHash') == self.hash(immutable(node_receipt, True)), 'periodic-prior-offsite-publication-unknown')
        self.resources = capacity(config)
        self.began = time.monotonic()
        self.published = False
        receipt = Path(config['receiptFile'])
        self.value = {'version': 1, 'sourceId': config['sourceId'], 'attemptId': secrets.token_hex(16),
                      'phase': 'started', 'startedAt': time.time(), 'identity': self.identity,
                      'previousReceiptHash': self.hash(receipt) if receipt.exists() else None}
        self.write(self.path, self.value)  # Durable before CaptureWindow.enter / any freeze.
        commands.periodic_attempt = self

    def check(self, resume=False):
        verify_self(self.config, self.commands, self.identity, resume)
        if not resume:
            self.deadline()

    def deadline(self):
        need(time.monotonic()-self.began <= policy(self.config)['maxCycleSeconds'], 'periodic-cycle-deadline')

    def finish(self, result):
        self.check()
        checkpoint = read_json(Path(self.config['backupRoot'])/'capture-state.json')
        need(checkpoint.get('phase') == 'resumed', 'periodic-resume-unverified')
        receipt = result['receipt']
        captured = dt.datetime.fromisoformat(receipt['verifiedAt'])
        age = (dt.datetime.now(dt.timezone.utc)-captured).total_seconds()
        need(result.get('ok') is True and receipt['sourceId'] == self.config['sourceId'] and 0 <= age < 35*60 and
             receipt['archiveSha256'] == self.hash(Path(self.config['backupRoot'])/result['archive']), 'periodic-receipt-unverified')
        # All semantic checks and plaintext cleanup have completed. Commit the expected
        # receipt hash first: a crash in this two-file window makes the NEXT admission
        # hold on a hash mismatch. Receipt is the final publication/linearization point.
        receipt_bytes = json.dumps(receipt, sort_keys=True).encode()
        with defer_signals():
            need(callable(self.jobs_write), 'periodic-jobs-publication-required')
            old=read_json(self.config['receiptFile']) if Path(self.config['receiptFile']).exists() else None
            expected_hash=hashlib.sha256(receipt_bytes).hexdigest()
            pc = installation_profile(self.config)['name'] == PC_PROFILE
            self.value.update(phase='local-verified' if pc else 'verified', finishedAt=time.time(), receiptHash=expected_hash,jobsReceiptHash=expected_hash)
            self.write(self.path, self.value)
            self.write(self.config['receiptFile'], receipt)
            try:
                self.jobs_write(self.config['jobsReceiptFile'], receipt)
            except BaseException:
                # Best-effort rollback of the private observer after failed public publication.
                # Any rollback/ack uncertainty is held, NEVER acknowledged/replayed automatically.
                if old is not None:self.write(self.config['receiptFile'],old)
                else:
                    Path(self.config['receiptFile']).unlink()
                    fd=os.open(Path(self.config['receiptFile']).parent,os.O_DIRECTORY|os.O_RDONLY)
                    try:os.fsync(fd)
                    finally:os.close(fd)
                raise
            # PC local publication is not admission. A crash before the one sender
            # invocation stays held; only its final canonical Node receipt admits writes.
            self.published = not pc

    def transfer_offsite(self, result):
        """One PC sender call after local receipt commit; unknown results never replay."""
        need(installation_profile(self.config)['name'] == PC_PROFILE and
             self.value.get('phase') == 'local-verified' and not getattr(self, '_offsite_attempted', False), 'periodic-offsite-not-sendable')
        self._offsite_attempted = True
        self.check()
        installed = seal(self.config)
        runtime, offsite, manifest = pc_offsite_inputs(self.config, installed)
        sender_inventory(runtime, installed, manifest)
        receipt = read_json(self.config['receiptFile'])
        need(receipt == result.get('receipt') and self.hash(self.config['receiptFile']) == self.value['receiptHash'], 'periodic-offsite-local-receipt')
        archive = result.get('archive')
        need(isinstance(archive, str) and Path(archive).name == archive and archive not in ('', '.', '..'), 'periodic-offsite-archive-path')
        archive = immutable(Path(self.config['backupRoot'])/archive, True)
        need(self.hash(archive) == receipt['archiveSha256'], 'periodic-offsite-archive-bytes')
        state = Path(offsite['stateDirectory'])
        info = state.lstat()
        need(state.is_absolute() and state.resolve() == state and stat.S_ISDIR(info.st_mode) and
             info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700 and info.st_dev == MOUNT.stat().st_dev, 'periodic-offsite-state')
        invocation = state/('producer-'+self.value['attemptId']+'.json')
        need(not invocation.exists(), 'periodic-offsite-invocation-held')
        self.write(invocation, {**offsite, 'archiveFile': str(archive)})
        immutable(invocation, True)
        self.value.update(phase='offsite-started', offsiteInvocationPath=str(invocation))
        self.write(self.path, self.value)
        self.check()
        # LocalCommands supplies a fixed clean environment, finite pipes/deadline,
        # no retry. A lost ACK may follow committed Node publication; never roll it back.
        raw = self.commands.run([installed['nodePath'], installed['sources']['offsite.mjs']['path'], str(invocation), '--apply'], timeout=120)
        need(isinstance(raw, (bytes, str)) and len(raw) <= 16384, 'periodic-offsite-ack-bound')
        ack = json.loads(raw)
        target = str(state/'local-snapshot.json')
        need(isinstance(ack, dict) and set(ack) == {'verified', 'sourceId', 'receipt'} and ack['verified'] is True and
             ack['sourceId'] == self.config['sourceId'] and ack['receipt'] == target, 'periodic-offsite-ack')
        snapshot = read_json(target)
        normalize = lambda value: dt.datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        captured, restored = normalize(receipt['verifiedAt']), normalize(receipt['restoreVerifiedAt'])
        stamp = captured.replace(':', '-').replace('.', '-')
        need(snapshot.get('format') == 'tuat-local-db-images-v1' and snapshot.get('sourceId') == self.config['sourceId'] and
             bool(re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', snapshot.get('generation', ''))) and
             snapshot.get('databaseSystemIdentifier') == receipt['databaseSystemIdentifier'] and snapshot.get('imageRoot') == receipt['imageRoot'] and
             snapshot.get('archiveSha256') == receipt['archiveSha256'] and snapshot.get('archiveBytes') == archive.stat().st_size and
             snapshot.get('archiveKey') == 'ops/pc-backend/'+self.config['sourceId']+'/backups/'+stamp+'.local.tar.enc' and
             snapshot.get('capturedAt') == captured and snapshot.get('restoreVerifiedAt') == restored and snapshot.get('independentRecoveryCopyChecked') is True,
             'periodic-offsite-receipt')
        completed = dt.datetime.fromisoformat(snapshot['offsiteVerifiedAt'].replace('Z', '+00:00'))
        need(dt.datetime.fromisoformat(restored.replace('Z', '+00:00')) <= completed <= dt.datetime.now(dt.timezone.utc), 'periodic-offsite-time')
        self.check()
        with defer_signals():
            self.value.update(phase='verified', finishedAt=time.time(), offsiteReceiptPath=target, offsiteReceiptHash=self.hash(immutable(target, True)))
            self.write(self.path, self.value)
            self.published = True
        return ack

    def hold(self):
        if self.published: return  # Pending SIGTERM after durable publication does not uncommit it.
        self.value['phase'] = 'unknown-hold'
        self.write(self.path, self.value)  # A failed write leaves the original started checkpoint, also held.

@contextmanager
def defer_signals():
    previous = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT})
    try:
        yield
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous)
