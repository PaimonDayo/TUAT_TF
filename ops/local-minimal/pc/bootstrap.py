#!/usr/bin/env python3
"""Open the existing PC disk and start the installed runtime. Never provisions storage."""
import argparse
import datetime as dt
import fcntl
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import stat
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace

sys.dont_write_bytecode = True
MOUNT = '/var/lib/tuat-local'
MAPPER = 'tuat-local-data'
CONFIG = '/etc/tuat-local/runtime.json'
BOOT_POLICY = '/etc/tuat-local/boot.json'
WATCH_STATUS = '/run/tuat-local-bootstrap-watch.json'
UNITS = ('tuat-local-containerd.service', 'tuat-local-docker.service', 'tuat-local-app.service')


class Held(Exception):
    pass


def need(condition, reason):
    if not condition:
        raise Held(reason)


def private_file(name, maximum=65536):
    path = Path(name)
    need(path.is_absolute() and '..' not in path.parts, 'input-path')
    for part in (path, *path.parents):
        need(not part.is_symlink(), 'input-link')
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 0 and
         stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= maximum, 'input-permissions')
    return path.read_bytes()


def run(arguments, data=None, allowed=(0,), timeout=45):
    result = subprocess.run(arguments, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=timeout, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin',
                                                 'LANG': 'C.UTF-8', 'DOCKER_CONFIG': '/nonexistent'})
    need(result.returncode in allowed, 'command-failed')
    need(len(result.stdout) <= 1024 * 1024, 'command-bound')
    return result.returncode, result.stdout.decode()


def storage_identity(config, command=run):
    need(config.get('version') == 1 and config.get('profile') == 'pc-private' and
         config.get('installEnabled') is True and config.get('mountPoint') == MOUNT and
         config.get('mapperName') == MAPPER and
         re.fullmatch('[a-f0-9-]{36}', config.get('luksUuid', '')) and
         re.fullmatch('[a-f0-9-]{36}', config.get('filesystemUuid', '')), 'configuration')
    backing = Path(config.get('backingFile', ''))
    need(str(backing) == '/var/lib/tuat-local-data-20261013.luks', 'backing-path')
    for part in (backing, *backing.parents):
        need(not part.is_symlink(), 'backing-link')
    info = backing.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and
         stat.S_IMODE(info.st_mode) == 0o600 and info.st_size == 32 * 1024**3, 'backing-identity')
    need(command(['/usr/sbin/cryptsetup', 'luksUUID', str(backing)])[1].strip() == config['luksUuid'], 'luks-uuid')
    return backing, (info.st_dev, info.st_ino, info.st_size)


def mapping(config, command=run):
    code, text = command(['/usr/sbin/cryptsetup', 'status', MAPPER], allowed=(0, 4))
    if code == 4:
        need(not Path('/dev/mapper/' + MAPPER).exists(), 'unknown-mapper')
        return None
    parts = dict(re.findall(r'^\s+([a-z]+):\s+(.+)$', text, re.M))
    device = parts.get('device', '')
    need(parts.get('type') == 'LUKS2' and parts.get('mode') == 'read/write' and
         re.fullmatch('/dev/loop[0-9]+', device), 'mapping-identity')
    rows = json.loads(command(['/usr/sbin/losetup', '--json', '--output', 'NAME,BACK-FILE', device])[1]).get('loopdevices')
    need(isinstance(rows, list) and len(rows) == 1 and rows[0].get('name') == device and
         rows[0].get('back-file') == config['backingFile'], 'loop-backing')
    need(command(['/usr/sbin/cryptsetup', 'luksUUID', device])[1].strip() == config['luksUuid'], 'mapping-luks')
    return device


def mounted(config, command=run):
    code, text = command(['/usr/bin/findmnt', '--json', '--mountpoint', MOUNT,
                          '-o', 'TARGET,SOURCE,FSTYPE,UUID,OPTIONS'], allowed=(0, 1))
    if code == 1:
        return False
    rows = json.loads(text).get('filesystems')
    need(isinstance(rows, list) and len(rows) == 1, 'mount-count')
    row = rows[0]
    need(row.get('target') == MOUNT and row.get('fstype') == 'ext4' and
         row.get('uuid') == config['filesystemUuid'] and
         {'rw', 'nosuid', 'nodev'} <= set(row.get('options', '').split(',')) and
         os.path.realpath(row.get('source', '')) == os.path.realpath('/dev/mapper/' + MAPPER), 'mount-identity')
    return True


def open_existing(config, key, apply, command=run):
    backing, identity = storage_identity(config, command)
    before_mapping, before_mount = mapping(config, command), mounted(config, command)
    if before_mount:
        need(before_mapping is not None, 'mounted-without-owned-mapping')
        return {'opened': False, 'mounted': False}
    need(apply, 'storage-not-mounted')
    directory = Path(MOUNT)
    need(not directory.is_symlink() and directory.is_dir() and directory.stat().st_uid == 0 and
         not any(directory.iterdir()), 'mountpoint-not-empty')
    if before_mapping is None:
        loops = json.loads(command(['/usr/sbin/losetup', '--json', '--associated', str(backing),
                                     '--output', 'NAME,BACK-FILE'])[1]).get('loopdevices', [])
        need(not loops, 'unowned-existing-loop')
        need(len(key) == 32, 'unlock-key')
        current = backing.lstat()
        need((current.st_dev, current.st_ino, current.st_size) == identity, 'backing-changed')
        command(['/usr/sbin/cryptsetup', 'open', '--type', 'luks2', '--key-file=-', str(backing), MAPPER], data=key)
        need(mapping(config, command) is not None, 'open-not-observed')
    # A failed/unknown command is never repeated here; the next invocation first observes it.
    command(['/usr/bin/mount', '--types', 'ext4', '--options', 'rw,nosuid,nodev', '/dev/mapper/' + MAPPER, MOUNT])
    need(mounted(config, command), 'mount-not-observed')
    return {'opened': before_mapping is None, 'mounted': True}


def service(name, command=run, watching=False):
    text = command(['/usr/bin/systemctl', 'show', name,
                    '--property=LoadState,ActiveState,SubState,FragmentPath,DropInPaths,ControlPID'])[1]
    result = dict(line.split('=', 1) for line in text.splitlines() if '=' in line)
    need(result.get('LoadState') == 'loaded' and
         result.get('FragmentPath') == '/etc/systemd/system/' + name and
         result.get('DropInPaths') == '' and
         (re.fullmatch('[0-9]+', result.get('ControlPID', '')) if watching else result.get('ControlPID') == '0') and
         result.get('ActiveState') in (('active', 'inactive', 'failed', 'activating', 'deactivating', 'reloading', 'maintenance')
                                      if watching else ('active', 'inactive')), 'service-state')
    return result


def enter_system_mount_namespace():
    """Mount where systemd evaluates ConditionPathIsMountPoint, before reading a key."""
    need(Path('/proc/1/comm').read_text().strip() == 'systemd', 'system-manager')
    descriptor = os.open('/proc/1/ns/mnt', os.O_RDONLY | os.O_CLOEXEC)
    try:
        target = os.fstat(descriptor)
        identity = lambda value: (value.st_dev, value.st_ino)
        if identity(os.stat('/proc/self/ns/mnt')) != identity(target):
            need(callable(getattr(os, 'setns', None)), 'mount-namespace-unavailable')
            os.setns(descriptor, 0)
        need(identity(os.stat('/proc/self/ns/mnt')) == identity(target), 'mount-namespace-unverified')
    finally:
        os.close(descriptor)


def wait_backup_idle(config, command=run, pause=time.sleep, clock=time.monotonic):
    """Observe one existing producer to completion, without dispatch, reset or replay."""
    if not config.get('backupConfigPath'):
        return
    name = 'tuat-local-backup.service'
    owner, deadline = None, clock() + 300
    while True:
        text = command(['/usr/bin/systemctl', 'show', name,
            '--property=LoadState,Type,ActiveState,SubState,FreezerState,MainPID,ControlPID,ControlGroup,InvocationID,FragmentPath,DropInPaths'], timeout=5)[1]
        state = dict(line.split('=', 1) for line in text.splitlines() if '=' in line)
        need(state.get('LoadState') == 'loaded' and state.get('Type') == 'oneshot' and
             state.get('FragmentPath') == '/etc/systemd/system/' + name and state.get('DropInPaths') == '' and
             state.get('FreezerState') == 'running' and state.get('ControlPID') == '0', 'backup-controller-unverified')
        if state.get('ActiveState') == 'inactive':
            need(state.get('SubState') == 'dead' and state.get('MainPID') == '0' and state.get('ControlGroup') == '', 'backup-not-idle')
            return
        need(state.get('ActiveState') == 'activating' and state.get('SubState') == 'start' and
             re.fullmatch('[1-9][0-9]*', state.get('MainPID', '')) and
             re.fullmatch('[a-f0-9]{32}', state.get('InvocationID', '')) and
             state.get('ControlGroup') == '/system.slice/' + name, 'backup-not-idle')
        current = (state['MainPID'], state['InvocationID'])
        need(owner is None or owner == current, 'backup-owner-changed')
        owner = current
        need(clock() < deadline, 'backup-wait-deadline')
        pause(2)


def write_watch_status(value):
    """One bounded root-private RAM file; Windows only consumes the first stdout line."""
    path = Path(WATCH_STATUS)
    parent = path.parent.lstat()
    need(not path.parent.is_symlink() and stat.S_ISDIR(parent.st_mode) and
         parent.st_uid == 0 and not parent.st_mode & 0o022, 'watch-status-directory')
    need(not path.is_symlink(), 'watch-status-link')
    if path.exists():
        private_file(str(path), 4096)
    data = (json.dumps({'version': 1, 'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(), **value}) + '\n').encode()
    need(len(data) <= 4096, 'watch-status-bound')
    descriptor, temporary = tempfile.mkstemp(prefix='.tuat-local-bootstrap-watch-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def watch_runtime(config, command=run, pause=time.sleep, report=write_watch_status):
    while True:
        # Storage ownership is mandatory; application health is an observation,
        # never an instruction to exit WSL, start a service or replay a request.
        need(mounted(config, command) and mapping(config, command) is not None, 'storage-no-longer-owned')
        try:
            state = service(UNITS[2], command, watching=True)['ActiveState']
        except (Held, OSError, subprocess.SubprocessError):
            state = 'unverified'
        try:
            report({'valid': state == 'active', 'watching': True, 'storageOwned': True,
                    'runtimeActive': state == 'active', 'runtimeState': state})
        except (Held, OSError):
            # A stale checkedAt exposes a reporting failure. Keep the storage
            # session alive even if its optional RAM status cannot be replaced.
            pass
        pause(30)


def transport_module(config):
    source = Path(config['releaseDirectory'])/'ops/local-minimal/transport.py'
    info = source.lstat()
    need(not source.is_symlink() and source.resolve() == source and stat.S_ISREG(info.st_mode) and
         info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o022, 'transport-source-file')
    manifest = json.loads(private_file(config['releaseManifest'], maximum=64*1024**2))
    pin = manifest.get('files', {}).get('ops/local-minimal/transport.py')
    commit = manifest.get('sourceCommit', '')
    need(re.fullmatch('[a-f0-9]{40}', commit) and commit.startswith(Path(config['releaseDirectory']).name) and
         hashlib.sha256(source.read_bytes()).hexdigest() == pin, 'transport-source-seal')
    spec = importlib.util.spec_from_file_location('tuat_boot_transport', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    need(hashlib.sha256(source.read_bytes()).hexdigest() == pin, 'transport-source-changed')
    return module


def transport_ready(config, command=run):
    module = transport_module(config)
    commands = SimpleNamespace(run=lambda args:command(args)[1])
    for attempt in range(120):
        try:
            observed = module.observe(config, commands, True)
        except module.Hold as error:
            if str(error) != 'transport-metrics-boundary':
                raise
        else:
            need(observed.get('policy', {}).get('enabled') is True and
                 observed.get('unit', {}).get('ActiveState') == 'active', 'transport-not-active')
            connection = http.client.HTTPConnection('127.0.0.1', 18305, timeout=1)
            try:
                connection.request('GET', '/ready')
                response = connection.getresponse()
                need(len(response.read(4097)) <= 4096, 'transport-ready-bound')
                if response.status == 200:
                    need(module.observe(config, commands, True) == observed, 'transport-identity-changed')
                    return
            except (OSError, http.client.HTTPException):
                pass
            finally:
                connection.close()
        if attempt < 119:
            time.sleep(0.25)
    raise Held('transport-not-ready')


def start_installed(config, policy, command=run):
    need(policy == {'version': 1, 'enabled': True, 'automaticBackups': False} or
         policy == {'version': 1, 'enabled': True, 'automaticBackups': True}, 'boot-policy')
    release = Path(config.get('releaseDirectory', ''))
    need(re.fullmatch('/var/lib/tuat-local/releases/[a-f0-9]{7,40}', str(release)), 'runtime-path')
    runtime = release / 'ops/local-minimal/runtime.py'
    need(runtime.is_file() and not runtime.is_symlink() and runtime.stat().st_uid == 0 and
         not runtime.stat().st_mode & 0o022, 'runtime-file')
    seals = config.get('daemonSeal', {})
    for field, path, mode in (
        ('containerdConfig', '/etc/tuat-local/containerd.toml', 0o600),
        ('dockerConfig', '/etc/tuat-local/docker.json', 0o600),
        ('containerdUnit', '/etc/systemd/system/tuat-local-containerd.service', 0o644),
        ('dockerUnit', '/etc/systemd/system/tuat-local-docker.service', 0o644)):
        item = Path(path)
        info = item.lstat()
        need(not item.is_symlink() and item.resolve() == item and stat.S_ISREG(info.st_mode) and
             info.st_uid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == mode and
             hashlib.sha256(item.read_bytes()).hexdigest() == seals.get(field), 'daemon-static-seal')
    tunnel_path = Path(MOUNT + '/private/tunnel.json')
    tunnel = json.loads(private_file(str(tunnel_path))) if tunnel_path.exists() else None
    for name in UNITS[:2]:
        state = service(name, command)
        if state['ActiveState'] == 'inactive':
            command(['/usr/bin/systemctl', 'start', name], timeout=120)
        need(service(name, command)['ActiveState'] == 'active', 'start-not-observed')
    command(['/usr/bin/python3', '-I', '-B', str(runtime), '--storage-only', CONFIG])
    if tunnel and tunnel.get('enabled') is True:
        command(['/usr/bin/python3', '-I', '-B', '/opt/tuat-local-runtime/transport.py', '--preflight'])
        state = service('tuat-local-tunnel.service', command)
        if state['ActiveState'] == 'inactive':
            command(['/usr/bin/systemctl', 'start', 'tuat-local-tunnel.service'])
        # Inactive unreferenced units can be garbage-collected immediately.
        # Keep this validated transport active before app's complete inventory.
        transport_ready(config, command)
    wait_backup_idle(config, command)
    app = service(UNITS[2], command)
    if app['ActiveState'] == 'inactive':
        command(['/usr/bin/systemctl', 'start', UNITS[2]], timeout=120)
    need(service(UNITS[2], command)['ActiveState'] == 'active', 'app-start-not-observed')
    host = json.loads(private_file(config['hostConfigPath']))
    ready = False
    for _ in range(120):
        connection = http.client.HTTPConnection('127.0.0.1', 18201, timeout=1)
        try:
            connection.request('GET', '/api/version')
            response = connection.getresponse()
            need(response.status == 200, 'app-version-unavailable')
            version = json.loads(response.read(16385))
            need(version.get('version') == host.get('releaseCommit'), 'app-version-mismatch')
            ready = True
            break
        except (Held, OSError, ValueError):
            need(service(UNITS[2], command)['ActiveState'] == 'active', 'app-stopped')
            time.sleep(0.25)
        finally:
            connection.close()
    need(ready, 'app-not-ready')
    wait_backup_idle(config, command)
    command(['/usr/bin/python3', '-I', '-B', str(runtime), '--check', CONFIG], timeout=120)
    # Jobs remain disabled until their preserved journal and the final backup are accepted.
    jobs = json.loads(private_file(config['jobsConfig']))
    if jobs.get('enabled') is True:
        state = service('tuat-local-jobs.service', command)
        if state['ActiveState'] == 'inactive':
            command(['/usr/bin/systemctl', 'start', 'tuat-local-jobs.service'], timeout=120)
    if policy['automaticBackups']:
        command(['/usr/bin/systemctl', 'start', 'tuat-local-backup.timer'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start', action='store_true')
    parser.add_argument('--watch', action='store_true')
    args = parser.parse_args()
    key = bytearray()
    lock = None
    try:
        need(sys.platform == 'linux' and os.getuid() == 0 and (args.start or not args.watch), 'entrypoint')
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        enter_system_mount_namespace()
        need(not Path('/proc/swaps').read_text().splitlines()[1:], 'swap-enabled')
        config = json.loads(private_file(CONFIG))
        if args.start:
            descriptor = os.open('/run/tuat-local-bootstrap.lock', os.O_CREAT | os.O_NOFOLLOW | os.O_RDWR, 0o600)
            lock = os.fdopen(descriptor, 'rb+')
            info = os.fstat(descriptor)
            need(info.st_uid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600, 'bootstrap-lock')
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            key = bytearray(sys.stdin.buffer.read(33))
            need(len(key) == 32, 'unlock-key')
        policy = json.loads(private_file(BOOT_POLICY)) if args.start else None
        if args.start:
            need(policy in ({'version': 1, 'enabled': True, 'automaticBackups': False},
                            {'version': 1, 'enabled': True, 'automaticBackups': True}), 'boot-policy')
        result = open_existing(config, key, args.start)
        for index in range(len(key)):
            key[index] = 0
        if args.start:
            start_installed(config, policy)
        print(json.dumps({'valid': True, **result, 'runtimeStarted': args.start}), flush=True)
        if args.watch:
            watch_runtime(config)
        return 0
    except Exception:
        print('{"valid":false,"automaticRetry":false}', flush=True)
        return 1
    finally:
        for index in range(len(key)):
            key[index] = 0
        if lock:
            lock.close()


if __name__ == '__main__':
    raise SystemExit(main())
