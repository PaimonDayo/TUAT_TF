#!/usr/bin/env python3
"""Opt-in Linux snapshot CLI. No daemon, arbitrary commands, or automatic replay.

Freezing is a bounded capture window, not graceful drain or external-job completion.
All commands address an explicit, labelled local source; verify uses a new network-none DB.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import secrets
import signal
import stat
import subprocess
import tarfile
import tempfile
import time
_periodic_spec = importlib.util.spec_from_file_location('tuat_periodic', Path(__file__).with_name('periodic.py'))
periodic = importlib.util.module_from_spec(_periodic_spec); _periodic_spec.loader.exec_module(periodic)

DB_IMAGE = 'supabase/postgres:17.6.1.136'
SOURCE_LABEL = 'tuat.local.source'
ROLE_LABEL = 'tuat.local.role'
VERIFY_LABEL = 'tuat.local.backup-verifier'
MAX_BYTES = 16 * 1024 ** 3
MAX_IMAGE = 12 * 1024 ** 2
MAX_ENTRIES = 100000
MAX_JOB_STATE = 1024 ** 2
JOB_STATE_FILES = ('journal.json', 'runner.lock', 'status.json')
JOB_IDS = ('sheets', 'program', 'cleanup', 'push')
SCHEMAS = ('auth', 'public', 'storage', 'pc_ops', 'extensions')
UNITS = ('tuat-local-jobs.service', 'tuat-local-app.service', 'tuat-local-mirror.service')
PRESERVED_TRIAL_UNITS = ('tuat-surface-trial-adapter.service', 'tuat-surface-trial-app.service',
                         'tuat-surface-trial-bridge.service', 'tuat-surface-trial-gateway.service',
                         'tuat-surface-trial-endurance.service')
IDENT = re.compile(r'^[a-z_][a-z_0-9]{0,62}$')
AVATAR = re.compile(r'^avatars/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(?:webp|jpe?g)$', re.I)
IMAGE = re.compile(r'^(?:tweet-images|note-images)/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$', re.I)


class BackupFailure(RuntimeError):
    pass


def fail(message):
    raise BackupFailure(message)


def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def private(path, directory=False, owner=None):
    path = Path(path)
    if not path.is_absolute() or path == Path('/') or path.resolve() != path:
        fail('Private absolute path without symlinks required')
    info = path.lstat()
    if info.st_uid != (os.getuid() if owner is None else owner) or stat.S_IMODE(info.st_mode) & 0o077 or \
       not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) or \
       (not directory and info.st_nlink != 1):
        fail('Private owner and mode required')
    return path


def read_private(path, bound=1024 ** 2, owner=None):
    path = private(path, owner=owner)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        if os.fstat(fd).st_size > bound:
            fail('Private metadata bound exceeded')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            return stream.read(bound + 1)
    finally:
        os.close(fd)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    sync_directory(Path(path).parent)


def atomic_json(path, value):
    path = Path(path)
    private(path.parent, True)
    temp = path.with_name(path.name + '.partial-' + secrets.token_hex(8))
    prior = read_private(path, 8 * 1024 ** 2) if path.exists() else None
    replaced = False
    try:
        write_new(temp, json.dumps(value, sort_keys=True).encode())
        os.replace(temp, path)
        replaced = True
        sync_directory(path.parent)
    except Exception:
        # A failed acknowledgement must not visibly advance the previous receipt/checkpoint.
        if replaced:
            if prior is None:
                path.unlink(missing_ok=True)
            else:
                rollback = path.with_name(path.name + '.rollback-' + secrets.token_hex(8))
                fd = os.open(rollback, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(prior); stream.flush(); os.fsync(stream.fileno())
                os.replace(rollback, path)
            sync_directory(path.parent)
        raise
    finally:
        temp.unlink(missing_ok=True)


def atomic_jobs_json(path, value, reader_gid=1000):
    """Only verified metadata, root:sealed-reader/0640 in root:sealed-reader/0750."""
    if type(reader_gid) is not int or not 1000 <= reader_gid < 2**32-1:
        fail('Explicit Jobs receipt reader group required')
    path=Path(path);parent=path.parent
    s=parent.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_gid!=reader_gid or stat.S_IMODE(s.st_mode)!=0o750:
        fail('Jobs receipt metadata directory contract refused')
    def checked_read(p):
        q=p.lstat()
        if not stat.S_ISREG(q.st_mode) or q.st_uid!=0 or q.st_gid!=reader_gid or q.st_nlink!=1 or stat.S_IMODE(q.st_mode)!=0o640 or q.st_size>1048576:
            fail('Jobs receipt metadata file contract refused')
        return p.read_bytes()
    old=checked_read(path) if path.exists() else None
    def stage(data):
        p=path.with_name(path.name+'.partial-'+secrets.token_hex(8))
        fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            with os.fdopen(fd,'wb') as stream:
                os.fchown(stream.fileno(),0,reader_gid);os.fchmod(stream.fileno(),0o640)
                stream.write(data);stream.flush();os.fsync(stream.fileno())
        except BaseException:
            p.unlink(missing_ok=True)
            raise
        return p
    data=json.dumps(value,sort_keys=True).encode()
    if len(data)>1048576:fail('Jobs receipt metadata size refused')
    temp=stage(data);replaced=False
    try:
        os.replace(temp,path);replaced=True;sync_directory(parent)
    except BaseException:
        if replaced:
            if old is None:path.unlink(missing_ok=True)
            else:
                rollback=stage(old);os.replace(rollback,path)
            sync_directory(parent)
        raise
    finally:temp.unlink(missing_ok=True)


def hash_stream(stream, copy=None):
    digest, size = hashlib.sha256(), 0
    while True:
        block = stream.read(1024 ** 2)
        if not block:
            break
        size += len(block)
        if size > MAX_BYTES:
            fail('Archive bound exceeded')
        digest.update(block)
        if copy:
            copy.write(block)
    return digest.hexdigest(), size


def file_hash(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        return hash_stream(stream)[0]


def safe_image(key):
    if not isinstance(key, str) or not (AVATAR.fullmatch(key) or IMAGE.fullmatch(key)):
        fail('Unsupported image reference; offline import must preserve/normalize paths first')
    return key


def retained_unreferenced_images(config):
    """Only an explicit sealed PC config can approve existing orphan bytes."""
    value = config.get('retainedUnreferencedImages', {})
    if not isinstance(value, dict) or len(value) > MAX_ENTRIES:
        fail('Invalid retained image baseline')
    if value and (periodic.installation_profile(config)['name'] != periodic.PC_PROFILE or periodic.policy(config) is None):
        fail('Retained image baseline requires sealed PC configuration')
    total, result = 0, {}
    for key, row in value.items():
        safe_image(key)
        if not isinstance(row, dict) or set(row) != {'sha256', 'bytes'} or \
           not isinstance(row['sha256'], str) or re.fullmatch('[a-f0-9]{64}', row['sha256']) is None or \
           type(row['bytes']) is not int or not 0 < row['bytes'] <= MAX_IMAGE:
            fail('Invalid retained image baseline entry')
        total += row['bytes']
        if total > MAX_BYTES:
            fail('Retained image baseline byte bound exceeded')
        result[key] = {'sha256': row['sha256'], 'bytes': row['bytes']}
    return result


def image_inventory(root, owner=None):
    root = private(root, True, owner)
    rows = []
    for parent, directories, files in os.walk(root, followlinks=False):
        for name in directories:
            private(Path(parent) / name, True, owner)
        for name in files:
            path = private(Path(parent) / name, owner=owner)
            key = safe_image(path.relative_to(root).as_posix())
            before = path.stat()
            if not 0 < before.st_size <= MAX_IMAGE or stat.S_IMODE(before.st_mode) != 0o600:
                fail('Image bounds invalid')
            digest = file_hash(path)
            after = path.stat()
            if (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != \
               (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                fail('Image changed during capture')
            rows.append({'key': key, 'bytes': before.st_size, 'sha256': digest,
                         'mtimeNs': before.st_mtime_ns, 'mode': 0o600})
            if len(rows) > MAX_ENTRIES:
                fail('Image inventory bound exceeded')
    return sorted(rows, key=lambda row: row['key'])


def journal_snapshot(directory, owner=None):
    """Keep raw journal/lock/status bytes. Historical holds never authorize replay."""
    root = private(directory, True, owner)
    rows, parsed_files = [], {}
    for path in sorted(root.iterdir()):
        if path.name not in JOB_STATE_FILES:
            fail('Unknown Jobs state or interrupted journal temp file')
        value = read_private(path, MAX_JOB_STATE, owner)
        parsed = json.loads(value)
        parsed_files[path.name] = parsed
        if path.name == 'journal.json':
            if not isinstance(parsed, dict) or parsed.get('version') != 1 or \
               not finite_number(parsed.get('activateAt')) or not isinstance(parsed.get('jobs'), dict):
                fail('Unknown Jobs journal format')
            validate_job_records(parsed['jobs'])
        elif path.name == 'runner.lock':
            if not isinstance(parsed.get('pid'), int) or parsed['pid'] <= 0 or \
               not isinstance(parsed.get('startedAt'), str):
                fail('Unknown Jobs runner lock')
        rows.append({'name': path.name, 'sha256': hashlib.sha256(value).hexdigest(), 'bytes': value})
    if 'status.json' in parsed_files:
        validate_jobs_status(parsed_files['status.json'], parsed_files.get('journal.json'))
    return rows


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_job_records(jobs):
    if not isinstance(jobs, dict):
        fail('Unknown Jobs status jobs')
    for ident, record in jobs.items():
        if ident not in JOB_IDS or not isinstance(record, dict) or not finite_number(record.get('slot')) or \
           record.get('status') not in ('success', 'partial', 'failed', 'uncertain'):
            fail('Jobs dispatch is running or unknown; no receipt may resolve it')
        for name in ('startedAt', 'finishedAt'):
            if name in record and not finite_number(record[name]):
                fail('Unknown Jobs status dispatch time')
        # recoverState only changes running -> uncertain; it adds no terminal time.
        # That interrupted current request must not pass as historical drained work,
        # even when status.json was never written. Leave all bytes/holds unchanged.
        if record['status'] == 'uncertain' and not finite_number(record.get('finishedAt')):
            fail('Current Jobs outcome lacks terminal dispatch evidence; no fresh receipt')
        if 'startedAt' in record and 'finishedAt' in record and record['finishedAt'] < record['startedAt']:
            fail('Unknown Jobs status dispatch interval')
        if 'httpStatus' in record and (not isinstance(record['httpStatus'], int) or \
           isinstance(record['httpStatus'], bool) or not 100 <= record['httpStatus'] <= 599):
            fail('Unknown Jobs status HTTP outcome')
        if any(name in record and not isinstance(record[name], bool)
               for name in ('sheetWritesSkipped', 'sheetWritesUncertain')):
            fail('Unknown Jobs status sheet hold')


def validate_jobs_status(status, journal):
    # run.mjs writes exactly {checkedAt: new Date().toISOString(), jobs: state.jobs}.
    # Status may lag a later terminal journal save, or retained manual review.
    # It is evidence, never an authority to clear sheet holds/unknown outcomes.
    if not isinstance(status, dict) or set(status) != {'checkedAt', 'jobs'} or \
       not isinstance(status['checkedAt'], str) or \
       not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z', status['checkedAt']) or \
       not isinstance(journal, dict) or journal.get('version') != 1 or \
       not finite_number(journal.get('activateAt')):
        fail('Unknown Jobs status/journal format')
    try:
        checked = dt.datetime.fromisoformat(status['checkedAt'].replace('Z', '+00:00')).timestamp() * 1000
    except ValueError:
        fail('Unknown Jobs status time')
    if checked > dt.datetime.now(dt.timezone.utc).timestamp() * 1000:
        fail('Jobs status time is in the future')
    for jobs in (journal.get('jobs'), status['jobs']):
        validate_job_records(jobs)
    for ident, record in status['jobs'].items():
        current = journal['jobs'].get(ident)
        if current is None or record['slot'] > current['slot'] or \
           (record['slot'] == current['slot'] and record['status'] != current['status']):
            fail('Jobs status contradicts the captured journal')


def validate_config(config):
    pp=periodic.policy(config)
    if pp is not None:
        p=config.get('jobsReceiptFile')
        if not isinstance(p,str) or not Path(p).is_absolute() or Path(p)==Path(config.get('receiptFile','')):
            fail('Explicit separate primary Jobs receipt required')
    if config.get('version') != 1 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', config.get('sourceId', '')):
        fail('Pinned source identity required')
    if config.get('writerMode') not in ('docker-fixture', 'surface-systemd'):
        fail('Concrete writer mode required')
    profile = periodic.installation_profile(config)
    if profile['name'] == periodic.PC_PROFILE:
        if config.get('writerMode') != 'surface-systemd' or pp is None or config.get('sourceOwnerUid') != 65530:
            fail('PC capture requires sealed controller and actor')
        if config.get('containers') != {role: 'tuat-local-'+role for role in ('db','auth','rest')}:
            fail('PC capture requires exact private source containers')
    if not isinstance(config.get('sourceOwnerUid', os.getuid()), int) or isinstance(config.get('sourceOwnerUid'), bool) or \
       config.get('sourceOwnerUid', os.getuid()) < 0:
        fail('Pinned source filesystem owner UID required')
    expected = {'db', 'auth', 'rest', 'jobs', 'app'} if config['writerMode'] == 'docker-fixture' else {'db', 'auth', 'rest'}
    if set(config.get('containers', {})) != expected or len(set(config['containers'].values())) != len(expected):
        fail('Complete concrete source inventory required')
    for name in config['containers'].values():
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,100}', name):
            fail('Invalid source container')
    if not IDENT.fullmatch(config.get('database', '')):
        fail('Explicit local database required')
    if config.get('dbImage') != DB_IMAGE or config.get('mirrorDisabled') is not True:
        fail('Pinned DB image and disabled legacy mirror required')
    retained_unreferenced_images(config)
    for name in ('imageRoot', 'jobsStateRoot', 'backupRoot', 'stageRoot', 'runtimeKey', 'receiptFile'):
        if not isinstance(config.get(name), str) or not Path(config[name]).is_absolute():
            fail('Explicit private backup paths required')
    roots = [Path(config[name]).resolve() for name in ('imageRoot', 'jobsStateRoot', 'backupRoot', 'stageRoot')]
    for i, root in enumerate(roots):
        if any(root == other or root in other.parents or other in root.parents for other in roots[i+1:]):
            fail('Source, backup, journal and private staging roots must be separate')
    if config.get('recoveryKeyCopy') is not None:
        if not isinstance(config['recoveryKeyCopy'], str) or not Path(config['recoveryKeyCopy']).is_absolute() or \
           Path(config['runtimeKey']).resolve() == Path(config['recoveryKeyCopy']).resolve():
            fail('Independent optional recovery-key copy required')
    if Path(config['receiptFile']).parent.resolve() != roots[2]:
        fail('Receipt must belong to private backup root')


def jobs_owner(config):
    return 0 if periodic.installation_profile(config)['name'] == periodic.PC_PROFILE else config.get('sourceOwnerUid', os.getuid())


def database_admin(config):
    return 'supabase_admin' if periodic.installation_profile(config)['name'] == periodic.PC_PROFILE else 'postgres'


def pc_vault_key():
    path = periodic.MOUNT/'db-private/pgsodium_root.key'
    for parent in (path, *path.parents):
        if parent.is_symlink(): fail('Vault key path must be canonical')
    item, parent = path.stat(), path.parent.stat()
    device = periodic.MOUNT.stat().st_dev
    if not stat.S_ISREG(item.st_mode) or item.st_uid != 0 or item.st_gid != 101 or item.st_nlink != 1 or \
       stat.S_IMODE(item.st_mode) != 0o640 or item.st_size != 65 or item.st_dev != device or \
       parent.st_uid != 0 or parent.st_gid != 101 or stat.S_IMODE(parent.st_mode) != 0o750 or parent.st_dev != device:
        fail('Vault key placement changed')
    data = path.read_bytes()
    if re.fullmatch(b'[a-f0-9]{64}\n', data) is None: fail('Vault key format changed')
    return data


def vault_fingerprint(config, commands):
    raw = commands.sql(config, "SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]'::jsonb)::text FROM vault.decrypted_secrets v;")
    rows = json.loads(raw)
    return {'rows': len(rows), 'sha256': hashlib.sha256(raw.strip()).hexdigest()}


class LocalCommands:
    """Fixed local Docker/systemd operations; config contains no executables/hooks."""
    def __init__(self, profile=None):
        self.profile = periodic.installation_profile(profile or {})
    def run(self, args, data=None, output=None, timeout=120, input_file=None, allowed=(0,)):
        # Drain both pipes with finite storage; even unexpected diagnostics are discarded,
        # never formatted into an exception, log or result. No inherited Docker context/TLS/env.
        env = {'PATH': '/opt/node-v24.19.0-linux-x64/bin:/usr/bin:/bin', 'HOME': '/nonexistent',
               'DOCKER_CONFIG': '/nonexistent', 'DOCKER_HOST': self.profile['socket'], 'LANG': 'C.UTF-8'}
        start = time.monotonic(); total = {'out': 0, 'err': 0}; captured = bytearray()
        maximum = 8*1024**2
        attempt = getattr(self, 'periodic_attempt', None)
        if output is not None:
            maximum = periodic.policy(attempt.config)['maxArchiveBytes'] if attempt else MAX_BYTES
        # stdin is bounded and file-backed; there is no stdin/stdout pipe deadlock.
        with (Path(input_file).open('rb') if input_file else tempfile.TemporaryFile()) as stdin:
            if data:
                if len(data) > 8*1024**2: fail('Command input bound exceeded')
                stdin.write(data); stdin.seek(0)
            proc = subprocess.Popen(args, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            streams = selectors.DefaultSelector()
            streams.register(proc.stdout, selectors.EVENT_READ, 'out')
            streams.register(proc.stderr, selectors.EVENT_READ, 'err')
            try:
                while streams.get_map():
                    if attempt and not getattr(self, 'periodic_resuming', False): attempt.deadline()
                    if time.monotonic()-start > timeout: fail('Local command deadline exceeded')
                    for key, _ in streams.select(0.1):
                        block = os.read(key.fd, 65536)
                        if not block:
                            streams.unregister(key.fileobj); continue
                        label = key.data; total[label] += len(block)
                        if total[label] > (maximum if label == 'out' else 65536):
                            fail('Local command output bound exceeded')
                        if label == 'out':
                            if output is not None:
                                if attempt: periodic.capacity(attempt.config, 0)
                                output.write(block)
                            else: captured.extend(block)
                self.last_returncode=proc.wait(timeout=max(0.1, timeout-(time.monotonic()-start)))
                if self.last_returncode not in allowed:
                    fail('Local backup command failed (private child output suppressed)')
                return bytes(captured)
            finally:
                streams.close()
                if proc.poll() is None:
                    proc.terminate()
                    try: proc.wait(timeout=3)
                    except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=3)
                proc.stdout.close(); proc.stderr.close()

    def docker(self, *args, **kwargs):
        return self.run(['docker', '--host', self.profile['socket'], '--config', '/nonexistent', *map(str, args)], **kwargs)

    def storage_gate(self, config):
        installed = periodic.seal(config)
        try:
            value = json.loads(self.run(['/usr/bin/python3', '-I', installed['sources']['runtime.py']['path'],
                                        '--storage-only', installed['runtimeConfigPath']]))
        except BackupFailure:
            fail('Periodic encrypted storage gate refused')
        if value != {'valid': True, 'scope': 'encrypted-storage-only'}:
            fail('Periodic encrypted storage gate refused')
        periodic.bind_storage(config)

    def inspect(self, name):
        return json.loads(self.docker('inspect', name))[0]

    def unit(self, name):
        allowed = UNITS + PRESERVED_TRIAL_UNITS + (periodic.UNIT,) + (periodic.PC_DAEMONS if self.profile['name'] == periodic.PC_PROFILE else ())
        if name not in allowed:
            fail('Unaccounted host writer/unit')
        raw = self.run(['systemctl', 'show', name,
            '--property=LoadState,ActiveState,SubState,FreezerState,ControlGroup,MainPID,ControlPID,InvocationID,ExecMainStartTimestampMonotonic'],
            allowed=(0,1,4))
        if len(raw) > 8192:
            fail('Systemd unit metadata bound exceeded')
        props = dict(line.split('=', 1) for line in raw.decode().splitlines() if '=' in line)
        # systemctl may return 1/4 for a missing unit. Only explicit not-found
        # metadata may represent that absence; command/manager errors stay closed.
        if props.get('LoadState') not in ('loaded','not-found'):
            fail('Local systemd observation failed (private child output suppressed)')
        if props.get('LoadState')=='loaded' and self.last_returncode!=0:
            fail('Local systemd observation failed (private child output suppressed)')
        return props

    def verify_jobs_lock(self, config, jobs_info=None):
        path = Path(config['jobsStateRoot']) / 'runner.lock'
        if not path.exists():
            return
        owner = json.loads(read_private(path,4096,jobs_owner(config)))
        pid = owner.get('pid')
        if not isinstance(pid,int) or isinstance(pid,bool) or pid<=0:
            fail('Unknown Jobs lock owner')
        if config['writerMode']=='docker-fixture':
            # This concrete fixture runs the labelled direct Node scheduler as PID 1, no init wrapper.
            if pid!=1 or not jobs_info or not jobs_info['State']['Running'] or jobs_info['HostConfig'].get('Init') or \
               jobs_info['HostConfig'].get('PidMode') not in (None,''):
                fail('Jobs lock owner is outside the verified direct scheduler')
            started=dt.datetime.fromisoformat(owner.get('startedAt','').replace('Z','+00:00'))
            born=dt.datetime.fromisoformat(jobs_info['State']['StartedAt'].replace('Z','+00:00'))
        else:
            group=self.unit(UNITS[0]).get('ControlGroup')
            if not group or group not in Path('/proc',str(pid),'cgroup').read_text().splitlines()[0].split(':'):
                fail('Jobs lock owner is outside the approved systemd cgroup')
            # PID reuse cannot authorize an old lock. Compare actual birth to recorded lock creation.
            proc=Path('/proc',str(pid),'stat').read_text(); ticks=int(proc.rsplit(')',1)[1].split()[19])
            boot=next(int(line.split()[1]) for line in Path('/proc/stat').read_text().splitlines() if line.startswith('btime '))
            born=dt.datetime.fromtimestamp(boot+ticks/os.sysconf('SC_CLK_TCK'),dt.timezone.utc)
            started=dt.datetime.fromisoformat(owner.get('startedAt','').replace('Z','+00:00'))
        if not 0<=(started-born).total_seconds()<300:
            fail('Jobs lock process identity/start time cannot be proven')

    def transition(self, kind, name, freeze):
        if kind == 'container':
            self.docker('pause' if freeze else 'unpause', name)
        else:
            self.run(['systemctl', 'freeze' if freeze else 'thaw', name])

    def sql(self, config, text, output=None):
        socket_args = ['--host=/tmp', '--port=18304'] if self.profile['name'] == periodic.PC_PROFILE and config['containers']['db'] == 'tuat-local-db' else []
        return self.docker('exec', '-i', config['containers']['db'], 'psql', *socket_args, '-U', database_admin(config),
                           '-d', config['database'], '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                           data=text.encode(), output=output)


def container_state(info):
    state = info['State']
    if state.get('Restarting') or state.get('Dead') or state.get('Status') not in ('running', 'paused', 'exited', 'created') or \
       (state.get('Status') == 'paused' and not (state['Running'] and state['Paused'])):
        fail('Unknown container state')
    return {'id': info['Id'], 'running': state['Running'], 'paused': state['Paused'],
            'startedAt': state['StartedAt'], 'restartCount': info['RestartCount']}


def unit_state(info):
    if info.get('LoadState') != 'loaded' or info.get('ActiveState') not in ('active', 'inactive') or \
       info.get('FreezerState') not in ('running', 'frozen') or \
       info.get('SubState') not in ('running', 'dead') or \
       not isinstance(info.get('ControlGroup'), str) or \
       not re.fullmatch(r'0|[1-9][0-9]*', info.get('MainPID', '')) or \
       not re.fullmatch(r'0|[1-9][0-9]*', info.get('ControlPID', '')):
        fail('Unknown systemd writer state')
    if info['ActiveState'] == 'inactive':
        inactive_unit_state(info)
    elif info['SubState'] != 'running':
        fail('Unknown systemd writer state')
    if info['ActiveState'] == 'active' and (not re.fullmatch('[a-f0-9]{32}',info.get('InvocationID','')) or
            not re.fullmatch('[1-9][0-9]*',info.get('ExecMainStartTimestampMonotonic',''))):
        fail('Host writer invocation/birth unverified')
    return {key: info[key] for key in ('ActiveState', 'SubState', 'FreezerState', 'ControlGroup',
                                      'MainPID', 'ControlPID','InvocationID','ExecMainStartTimestampMonotonic')}


def inactive_unit_state(info, missing_allowed=False):
    """An inactive name is not proof if a process/cgroup or unknown state remains."""
    if info.get('LoadState') not in (('loaded', 'not-found') if missing_allowed else ('loaded',)) or \
       info.get('ActiveState') != 'inactive' or info.get('SubState') != 'dead' or \
       info.get('FreezerState') != 'running' or info.get('MainPID') != '0' or \
       info.get('ControlPID') != '0' or info.get('ControlGroup') != '':
        fail('Preserved host unit must be inactive without PID or cgroup')
    return {key: info[key] for key in ('LoadState', 'ActiveState', 'SubState', 'FreezerState',
                                      'ControlGroup', 'MainPID', 'ControlPID')}


class CaptureWindow:
    def __init__(self, config, commands, checkpoint):
        self.config, self.commands, self.checkpoint = config, commands, Path(checkpoint)
        self.before, self.changed, self.preserved_units = [], [], {}
        self.host_units = None
        self.daemons = {}

    def observe(self, kind, name):
        return container_state(self.commands.inspect(name)) if kind == 'container' else unit_state(self.commands.unit(name))

    def host_inventory(self):
        lines = self.commands.run(['systemctl', 'list-units', '--all', '--plain', '--no-legend', 'tuat-*.service']).decode()
        names = set()
        for line in lines.splitlines():
            columns = line.split()
            controller = columns[0] == periodic.UNIT if columns else False
            p = periodic.installation_profile(self.config)
            allowed = UNITS + PRESERVED_TRIAL_UNITS + ((periodic.UNIT,) if self.config.get('periodic') else ()) + (periodic.PC_DAEMONS if p['name'] == periodic.PC_PROFILE else ())
            if len(columns) < 4 or columns[0] not in allowed or columns[0] in names or columns[1] != 'loaded':
                fail('Unaccounted host writer/unit')
            if controller:
                resuming = getattr(self, 'resuming', False)
                periodic.verify_self(self.config, self.commands, self.commands.periodic_attempt.identity, resuming)
                if columns[2:4] != ['activating','start'] and not (resuming and columns[2:4] == ['deactivating','stop-sigterm']):
                    fail('Unaccounted host controller lifecycle')
            elif columns[2] not in ('active','inactive'):
                fail('Unaccounted host writer/unit')
            names.add(columns[0])
        return names

    def enter(self):
        config, commands = self.config, self.commands
        source = config['sourceId']
        infos = {role: commands.inspect(name) for role, name in config['containers'].items()}
        for role, info in infos.items():
            if info['Config'].get('Labels', {}).get(SOURCE_LABEL) != source or \
               info['Config'].get('Labels', {}).get(ROLE_LABEL) != role or info['HostConfig']['Privileged']:
                fail('Source inventory label or privilege mismatch')
        if infos['db']['Config']['Image'] != DB_IMAGE or not infos['db']['State']['Running'] or infos['db']['State']['Paused']:
            fail('Source DB must be running on the pinned image')
        # Reject any extra source container, or a container with access to source files/network.
        ids = commands.docker('ps', '-aq').decode().split()
        known = {info['Id'] for info in infos.values()}
        protected_mounts = {item.get('Source') for info in (infos['db'],)
                            for item in info.get('Mounts', []) if item.get('Source')}
        protected_mounts.add(config['imageRoot'])
        networks = {infos['db']['HostConfig']['NetworkMode']}
        networks.update('container:' + info['Id'] for info in infos.values())
        networks.update('container:' + name for name in config['containers'].values())
        for ident in ids:
            info = commands.inspect(ident)
            if info['Id'] in known:
                continue
            same_source = info['Config'].get('Labels', {}).get(SOURCE_LABEL) == source
            access_files = any(m.get('Source') and any(
                Path(m['Source']) == Path(p) or Path(m['Source']) in Path(p).parents or Path(p) in Path(m['Source']).parents
                for p in protected_mounts) for m in info.get('Mounts', []))
            access_network = info['HostConfig']['NetworkMode'] in networks - {'none'}
            if same_source or (info['State']['Running'] and (access_files or access_network)):
                fail('Unaccounted source writer/container')
        commands.verify_jobs_lock(config,infos.get('jobs'))
        if config['writerMode'] == 'surface-systemd':
            # Preserve only the five exact old trial names, with no live process.
            # An absent mirror is disabled; it does not require a new stub unit.
            self.host_units = self.host_inventory()
            if periodic.installation_profile(config)['name'] == periodic.PC_PROFILE:
                if not set(periodic.PC_DAEMONS).issubset(self.host_units): fail('Private source daemon inventory missing')
                for name in periodic.PC_DAEMONS:
                    state = unit_state(commands.unit(name))
                    if state['ActiveState'] != 'active' or state['FreezerState'] != 'running' or state['ControlPID'] != '0' or \
                            state['MainPID'] == '0' or state['ControlGroup'] != '/system.slice/' + name:
                        fail('Private source daemon state unverified')
                    self.daemons[name] = state
            for name in self.host_units & set(PRESERVED_TRIAL_UNITS):
                self.preserved_units[name] = inactive_unit_state(commands.unit(name))
            self.preserved_units[UNITS[2]] = inactive_unit_state(commands.unit(UNITS[2]), missing_allowed=True)
            writers = [('unit', UNITS[0]), ('unit', UNITS[1])]
        else:
            writers = [('container', config['containers']['jobs']), ('container', config['containers']['app'])]
        writers += [('container', config['containers'][role]) for role in ('auth', 'rest')]
        self.before = [{'kind': kind, 'name': name, 'state': self.observe(kind, name)} for kind, name in writers]
        self.persist('capturing')
        for entry in self.before:
            state = entry['state']
            active = state.get('running', state.get('ActiveState') == 'active')
            frozen = state.get('paused', state.get('FreezerState') == 'frozen')
            if active and not frozen:
                self.changed.append(entry) # Persist intent BEFORE a command that could succeed then time out.
                self.persist('capturing')
                commands.transition(entry['kind'], entry['name'], True)
            actual = self.observe(entry['kind'], entry['name'])
            expected = {**state, **({'paused': active} if entry['kind'] == 'container' else
                                    {'FreezerState': 'frozen' if active else 'running'})}
            if actual != expected:
                fail('Writer freeze not verified')

    def persist(self, phase):
        atomic_json(self.checkpoint, {'version': 1, 'sourceId': self.config['sourceId'],
                    'phase': phase, 'writers': self.before,
                    'changed': [{'kind': row['kind'], 'name': row['name']} for row in self.changed],
                    **({'controller': self.commands.periodic_attempt.identity} if hasattr(self.commands,'periodic_attempt') else {})})

    def verify_frozen(self):
        self.verify_preserved_units()
        for entry in self.before:
            state = entry['state']
            active = state.get('running', state.get('ActiveState') == 'active')
            expected = {**state, **({'paused': active} if entry['kind'] == 'container' else
                                    {'FreezerState': 'frozen' if active else 'running'})}
            if self.observe(entry['kind'], entry['name']) != expected:
                fail('Capture writer no longer frozen or identity changed')

    def verify_preserved_units(self):
        if self.host_units is not None and self.host_inventory() != self.host_units:
            fail('Host unit inventory changed during capture')
        for name, state in self.preserved_units.items():
            if inactive_unit_state(self.commands.unit(name), missing_allowed=name == UNITS[2]) != state:
                fail('Preserved host unit state changed during capture')
        for name, state in self.daemons.items():
            if unit_state(self.commands.unit(name)) != state: fail('Private daemon identity changed during capture')

    def restore(self):
        # systemctl stop changes only controller lifecycle. Preserve self PID/birth/cgroup/pins,
        # permit that exact stop transition during recovery, never during new capture.
        attempt = getattr(self.commands, 'periodic_attempt', None)
        failed = False
        if attempt:
            try: attempt.check(resume=True)
            except Exception: failed = True  # Still rescue unchanged original writers; never publish a receipt.
        for entry in reversed(self.changed):
            try:
                actual = self.observe(entry['kind'], entry['name'])
                if entry['kind'] == 'container':
                    expected_frozen = {**entry['state'], 'paused': True}
                    if actual == expected_frozen:
                        self.commands.transition(entry['kind'], entry['name'], False)
                    elif actual != entry['state']:
                        fail('Writer identity changed; operator recovery required')
                else:
                    if actual == {**entry['state'], 'FreezerState': 'frozen'}:
                        self.commands.transition(entry['kind'], entry['name'], False)
                    elif actual != entry['state']:
                        fail('Host writer identity changed; operator recovery required')
            except Exception:
                failed = True
        for entry in self.before:
            try:
                if self.observe(entry['kind'], entry['name']) != entry['state']:
                    failed = True
            except Exception:
                failed = True
        try:
            self.resuming = True
            self.verify_preserved_units()
        except Exception:
            failed = True
        self.persist('resume-unverified' if failed else 'resumed')
        if failed:
            fail('Previous writer states not restored; no receipt; inspect capture checkpoint')


def assert_database_quiet(config, commands):
    value = commands.sql(config, """SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
AND pid<>pg_backend_pid() AND (backend_type='client backend' AND
 (state IS DISTINCT FROM 'idle' OR application_name NOT IN ('postgrest','GoTrue')) OR xact_start IS NOT NULL);
SELECT count(*) FROM pg_prepared_xacts;
SELECT CASE WHEN to_regclass('cron.job') IS NULL THEN 0 ELSE 1 END;
SELECT count(*) FROM pg_subscription;
SELECT count(*) FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN
 ('information_schema','auth','public','storage','pc_ops','extensions');
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('auth','public','storage','pc_ops','extensions') AND c.relkind IN ('f','m');
""").decode().splitlines()
    if value != ['0', '0', '0', '0', '0', '0']:
        fail('Active/unknown DB writer, prepared transaction, cron, subscription or unsupported schema/table')
    # An external Push dispatch already claimed cannot be resolved by freezing this process.
    present = commands.sql(config, "SELECT to_regclass('pc_ops.local_push_delivery') IS NOT NULL;").decode().strip()
    if present == 't':
        value = commands.sql(config, "SELECT count(*) FROM pc_ops.local_push_delivery WHERE state='claimed';").decode().strip()
        if value != '0':
            fail('Push dispatch remains in flight; freeze cannot prove external completion')


def image_references(config, commands):
    rows = commands.sql(config, """SELECT 'avatars/'||avatar_url FROM public.profiles WHERE avatar_url IS NOT NULL AND avatar_url<>''
UNION SELECT 'tweet-images/'||image_path FROM public.tweets WHERE image_path IS NOT NULL
UNION SELECT 'note-images/'||path FROM public.note_article_images ORDER BY 1;""").decode().splitlines()
    return sorted({safe_image(row) for row in rows})


def database_fingerprint(config, commands):
    order = 'to_jsonb(t)::text' + (' COLLATE "C"' if periodic.installation_profile(config)['name'] == periodic.PC_PROFILE else '')
    tables = commands.sql(config, """SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('r','p') AND n.nspname IN ('auth','public','storage','pc_ops','extensions') ORDER BY 1;""").decode().splitlines()
    result = {}
    # COPY one row at a time, ordered deterministically, so full DB data never accumulates in RAM/logs.
    for table in tables:
        parts = table.split('.')
        if len(parts) != 2 or not all(IDENT.fullmatch(part) for part in parts):
            fail('Unexpected source table name')
        with tempfile.TemporaryFile(dir=config['stageRoot']) as output:
            commands.sql(config, f'COPY (SELECT to_jsonb(t)::text FROM {table} t ORDER BY {order}) TO STDOUT;', output)
            output.seek(0)
            digest, size = hash_stream(output)
            output.seek(0)
            count = sum(1 for _ in output)
        result[table] = {'sha256': digest, 'rows': count, 'bytes': size}
    security = commands.sql(config, """SELECT jsonb_build_object(
'roles',(SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig) ORDER BY rolname) FROM pg_roles WHERE rolname !~ '^pg_'),
'membership',(SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(roleid),pg_get_userbyid(member),admin_option,inherit_option,set_option) ORDER BY roleid::regrole::text,member::regrole::text) FROM pg_auth_members),
'tables',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),(SELECT array_agg(a::text ORDER BY a::text) FROM unnest(coalesce(c.relacl,acldefault('r',c.relowner))) a)) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname IN ('auth','public','storage','pc_ops')),
'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('auth','public','storage','pc_ops')),
'constraints',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid)) ORDER BY n.nspname,c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('auth','public','storage','pc_ops')),
'functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),(SELECT array_agg(a::text ORDER BY a::text) FROM unnest(coalesce(p.proacl,acldefault('f',p.proowner))) a),p.prosecdef,p.proconfig,pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('auth','public','storage','pc_ops') AND p.prokind IN ('f','p')),
'triggers',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('auth','public','storage','pc_ops')),
'sequences',(SELECT jsonb_agg(to_jsonb(s) ORDER BY schemaname,sequencename) FROM pg_sequences s WHERE schemaname IN ('auth','public','storage','pc_ops')),
'schemas',(SELECT jsonb_agg(jsonb_build_array(nspname,pg_get_userbyid(nspowner),(SELECT array_agg(a::text ORDER BY a::text) FROM unnest(coalesce(nspacl,acldefault('n',nspowner))) a)) ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('auth','public','storage','pc_ops','extensions')),
'extensions',(SELECT jsonb_agg(jsonb_build_array(e.extname,e.extversion,n.nspname) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace));
""")
    components = json.loads(security)
    return {'tables': result, 'securitySha256': hashlib.sha256(security).hexdigest(),
            'securityComponents': {name: hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
                                   for name, value in components.items()}}


class BoundedBundle:
    def __init__(self, stream, config, attempt=None):
        self.stream, self.config, self.size, self.attempt = stream, config, 0, attempt
    def write(self, data):
        if self.attempt: self.attempt.deadline()
        self.size += len(data)
        limit = periodic.policy(self.config)['maxArchiveBytes'] if self.config.get('periodic') else MAX_BYTES
        if self.size > limit: fail('Capture archive byte bound exceeded')
        if self.config.get('periodic'): periodic.capacity(self.config, 0)
        return self.stream.write(data)
    def tell(self): return self.stream.tell()
    def flush(self): return self.stream.flush()


def capture_bundle(config, commands, stage):
    retained = retained_unreferenced_images(config)
    periodic.pc_database(config)
    assert_database_quiet(config, commands)
    owner = config.get('sourceOwnerUid', os.getuid())
    journal = journal_snapshot(config['jobsStateRoot'], jobs_owner(config))
    images = image_inventory(config['imageRoot'], owner)
    refs = image_references(config, commands)
    keys = {row['key'] for row in images}
    cleanup = commands.sql(config, "SELECT 'note-images/'||path FROM public.note_image_cleanup ORDER BY 1;").decode().splitlines()
    cleanup = {safe_image(row) for row in cleanup}
    # Confirmed retirement holds keep old signed avatars alive for seven days.
    # These optional cleanup objects may already be absent after unlink; they
    # are not live references and must not be required or silently discarded.
    retired = commands.sql(config, "SELECT bucket||'/'||path FROM public.confirmed_image_retirements WHERE confirmed_at IS NOT NULL AND deleted_at IS NULL ORDER BY 1;").decode().splitlines()
    cleanup.update(safe_image(row) for row in retired)
    if not set(refs).issubset(keys):
        fail('Image unlink-before-DB-delete gap or missing referenced image')
    unreferenced = keys - (set(refs) | cleanup)
    if unreferenced != set(retained):
        fail('Unreferenced image/upload interrupted before DB save; no success receipt')
    by_key = {row['key']: row for row in images}
    if any(by_key[key]['sha256'] != row['sha256'] or by_key[key]['bytes'] != row['bytes'] for key, row in retained.items()):
        fail('Retained unreferenced image bytes changed; no success receipt')
    before = database_fingerprint(config, commands)
    for name, argv in (
        ('database.dump', ['pg_dump', '-U', database_admin(config), '-d', config['database'], '--format=custom']),
        ('roles.sql', ['pg_dumpall', '-U', database_admin(config), '--roles-only', '--no-role-passwords']),
    ):
        if periodic.installation_profile(config)['name'] == periodic.PC_PROFILE:
            argv += ['--host=/tmp', '--port=18304']
        with (stage / name).open('xb') as output:
            os.chmod(stage / name, 0o600)
            commands.docker('exec', config['containers']['db'], *argv, output=output)
            output.flush(); os.fsync(output.fileno())
    manifest = {'version': 1, 'format': 'tuat-local-db-images-v1', 'sourceId': config['sourceId'],
                'databaseSystemIdentifier': commands.sql(config, 'SELECT system_identifier::text FROM pg_control_system();').decode().strip(),
                'capturedAt': stamp(), 'database': before, 'schemas': list(SCHEMAS),
                'recoveryKeyFingerprint': hashlib.sha256(read_private(config['runtimeKey'],32)).hexdigest(),
                'imageReferences': refs, 'images': images,
                'jobs': [{'name': row['name'], 'sha256': row['sha256']} for row in journal],
                'files': {name: file_hash(stage / name) for name in ('database.dump', 'roles.sql')},
                'credentials': 'PostgreSQL login passwords and app/Auth/JWT configuration require independent private recovery storage'}
    if retained:
        manifest['retainedUnreferencedImages'] = retained
    files = ['database.dump', 'roles.sql']
    pc = periodic.installation_profile(config)['name'] == periodic.PC_PROFILE
    if pc:
        write_new(stage/'vault-root.key', pc_vault_key())
        files.append('vault-root.key')
        manifest['files']['vault-root.key'] = file_hash(stage/'vault-root.key')
        manifest['vault'] = vault_fingerprint(config, commands)
    write_new(stage / 'manifest.json', json.dumps(manifest, sort_keys=True).encode())
    for row in journal:
        write_new(stage / ('jobs-' + row['name']), row['bytes'])
    bundle = stage / 'bundle.tar'
    with bundle.open('xb') as output:
        os.chmod(bundle, 0o600)
        with tarfile.open(fileobj=BoundedBundle(output, config, getattr(commands, 'periodic_attempt', None)), mode='w', format=tarfile.PAX_FORMAT) as archive:
            for name in ('manifest.json', *files):
                archive.add(stage / name, arcname=name, recursive=False)
            for row in journal:
                archive.add(stage / ('jobs-' + row['name']), arcname='jobs/' + row['name'], recursive=False)
            for row in images:
                archive.add(Path(config['imageRoot']) / row['key'], arcname='images/' + row['key'], recursive=False)
    os.chmod(bundle, 0o600)
    with bundle.open('rb') as stream:
        os.fsync(stream.fileno())
    sync_directory(stage)
    if bundle.stat().st_size > MAX_BYTES or before != database_fingerprint(config, commands) or \
       images != image_inventory(config['imageRoot'], owner) or journal != journal_snapshot(config['jobsStateRoot'], jobs_owner(config)):
        fail('Capture changed or exceeded bound')
    if pc and (read_private(stage/'vault-root.key', 65) != pc_vault_key() or manifest['vault'] != vault_fingerprint(config, commands)):
        fail('Vault recovery changed while frozen')
    assert_database_quiet(config, commands)
    return bundle, manifest


def verified_extract(bundle, destination, source_id):
    """Authenticated input only. Whitelist topology, no extractall or overwrite."""
    private(destination, True)
    if stat.S_IMODE(destination.stat().st_mode) != 0o700:
        fail('Private restored directory mode required')
    names, manifest, total = set(), None, 0
    (destination / 'images').mkdir(mode=0o700)
    with tarfile.open(bundle, 'r:') as archive:
        for item in archive:
            total += item.size
            if len(names) >= MAX_ENTRIES or total > MAX_BYTES or not item.isreg() or item.name in names or \
               item.size < 0 or item.size > MAX_BYTES or item.name.startswith('/') or '..' in PurePosixPath(item.name).parts:
                fail('Unsafe archive entry')
            name = item.name
            allowed = name in ('manifest.json', 'database.dump', 'roles.sql', 'vault-root.key') or \
                      name in ('jobs/' + state_name for state_name in JOB_STATE_FILES)
            if not allowed:
                if not name.startswith('images/'):
                    fail('Unlisted archive member')
                safe_image(name[7:])
                if item.size > MAX_IMAGE:
                    fail('Image archive bound exceeded')
            if name == 'manifest.json' and item.size > 8 * 1024 ** 2:
                fail('Manifest bound exceeded')
            if name == 'vault-root.key' and item.size != 65:
                fail('Vault key archive bound exceeded')
            if name.startswith('jobs/') and item.size > MAX_JOB_STATE:
                fail('Jobs archive metadata bound exceeded')
            path = destination / name
            # parents=True applies mode only to the last directory; intermediate
            # avatar/image directories would otherwise inherit 755 from umask.
            parent = destination
            for component in PurePosixPath(name).parts[:-1]:
                parent = parent / component
                try:
                    parent.mkdir(mode=0o700)
                except FileExistsError:
                    pass
                private(parent, True)
                if stat.S_IMODE(parent.stat().st_mode) != 0o700:
                    fail('Private restored directory mode required')
            with archive.extractfile(item) as source, path.open('xb') as output:
                os.chmod(path, 0o600)
                _, size = hash_stream(source, output)
                if size != item.size:
                    fail('Truncated archive member')
                output.flush(); os.fsync(output.fileno())
            names.add(name)
            if name == 'manifest.json':
                manifest = json.loads(read_private(path, 8 * 1024 ** 2))
    if not manifest or manifest.get('version') != 1 or manifest.get('format') != 'tuat-local-db-images-v1' or \
       manifest.get('sourceId') != source_id:
        fail('Authenticated manifest identity mismatch')
    expected = {'manifest.json', 'database.dump', 'roles.sql'}
    for name in ('database.dump', 'roles.sql'):
        if file_hash(destination / name) != manifest['files'][name]:
            fail('Restored DB/roles hash mismatch')
    if 'vault' in manifest:
        expected.add('vault-root.key')
        key = read_private(destination/'vault-root.key', 65)
        if re.fullmatch(b'[a-f0-9]{64}\n', key) is None or file_hash(destination/'vault-root.key') != manifest['files'].get('vault-root.key'):
            fail('Restored Vault key hash/format mismatch')
    with (destination / 'database.dump').open('rb') as stream:
        if stream.read(5) != b'PGDMP':
            fail('Invalid custom-format database dump')
    for row in manifest['images']:
        key = safe_image(row['key']); expected.add('images/' + key)
        path = destination / 'images' / key
        if path.stat().st_size != row['bytes'] or file_hash(path) != row['sha256'] or row['mode'] != 0o600:
            fail('Restored image hash mismatch')
        os.utime(path, ns=(row['mtimeNs'], row['mtimeNs']))
    for row in manifest['jobs']:
        if row['name'] not in JOB_STATE_FILES:
            fail('Invalid Jobs archive')
        name = 'jobs/' + row['name']; expected.add(name)
        if file_hash(destination / name) != row['sha256']:
            fail('Restored Jobs state changed')
    if manifest['jobs']:
        journal_snapshot(destination / 'jobs')
    if names != expected or len(manifest['images']) != len({row['key'] for row in manifest['images']}) or \
       not set(manifest['imageReferences']).issubset({row['key'] for row in manifest['images']}):
        fail('Archive topology/reference mismatch')
    return manifest


def verify_restore(config, commands, restored, manifest):
    nonce = secrets.token_hex(8)
    name = 'tuat-backup-verify-' + nonce
    empty = restored / 'empty-init'; empty.mkdir(mode=0o755); empty.chmod(0o755)
    created = False
    pc = periodic.installation_profile(config)['name'] == periodic.PC_PROFILE
    admin = database_admin(config)
    vault_mount = []
    preload = []
    if pc:
        if 'vault' not in manifest: fail('PC restore requires authenticated Vault recovery')
        key_copy = restored/'verifier-vault-root.key'
        write_new(key_copy, read_private(restored/'vault-root.key', 65))
        os.chown(key_copy, 0, 101); os.chmod(key_copy, 0o640)
        vault_mount = ['--mount', 'type=bind,source='+str(key_copy)+',target=/etc/postgresql-custom/pgsodium_root.key,readonly']
        preload = ['-c', 'vault.getkey_script=/usr/share/postgresql/extension/pgsodium_getkey']
    try:
        # Reserve name before run so a create-then-timeout is still cleaned by identity/label.
        commands.docker('create', '--name', name, '--label', VERIFY_LABEL + '=' + nonce,
            '--pull', 'never',
            '--network', 'none', '--memory', '768m', '--cpus', '1',
            '--mount', 'type=bind,source=' + str(empty) + ',target=/docker-entrypoint-initdb.d,readonly',
            *vault_mount, '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '-e', 'POSTGRES_USER='+admin,
            '-e', 'POSTGRES_PASSWORD=' + secrets.token_hex(32), '-e', 'POSTGRES_DB=fixture',
            '-e', 'PGDATA=/var/lib/postgresql/data',
            *(['-e', 'POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C.UTF-8'] if pc else []),
            DB_IMAGE, 'postgres', '-D', '/var/lib/postgresql/data',
            '-c', 'listen_addresses=', '-c', 'shared_preload_libraries='+('supabase_vault' if pc else ''), '-c', 'shared_buffers=64MB', *preload)
        created = True
        commands.docker('start', name)
        fixture = {**config, 'containers': {'db': name}, 'database': 'fixture'}
        for attempt in range(60):
            try:
                commands.sql(fixture, 'SELECT 1;')
                break
            except BackupFailure:
                if attempt == 59:
                    raise
                time.sleep(1)
        roles = read_private(restored / 'roles.sql', 8 * 1024 ** 2).decode()
        # Keep the source bootstrap admin identity; postgres has restricted flags on this PC.
        roles = re.sub(r'^CREATE ROLE '+re.escape(admin)+r';\r?\n', '', roles, flags=re.M)
        commands.sql(fixture, roles)
        commands.docker('exec', '-i', name, 'pg_restore', '-U', admin, '-d', 'fixture',
                        '--exit-on-error', '--single-transaction', input_file=restored / 'database.dump', timeout=300)
        actual = database_fingerprint(fixture, commands)
        expected = manifest['database']
        if actual != expected:
            # Only table/component identifiers are diagnostic; never row/role/secret contents.
            tables = sorted(name for name in set(actual['tables']) | set(expected['tables'])
                            if actual['tables'].get(name) != expected['tables'].get(name))
            sections = sorted(name for name in set(actual['securityComponents']) | set(expected['securityComponents'])
                              if actual['securityComponents'].get(name) != expected['securityComponents'].get(name))
            fail('Independent restore differs; tables=' + ','.join(tables) + '; security=' + ','.join(sections))
        if pc and vault_fingerprint(fixture, commands) != manifest['vault']:
            fail('Independent restored Vault values differ')
        if image_inventory(restored / 'images') != manifest['images']:
            fail('Independent image bytes/paths/mtime differ')
        return {'databaseTables': len(manifest['database']['tables']), 'images': len(manifest['images'])}
    finally:
        # Also inspect the reserved name after docker create timeout; delete only our random label.
        try:
            info = commands.inspect(name)
        except BackupFailure:
            if created:
                fail('Disposable verifier cleanup unverified')
        else:
            if info['Config'].get('Labels', {}).get(VERIFY_LABEL) != nonce:
                fail('Disposable verifier identity changed')
            commands.docker('rm', '-f', name)


def produce_locked(config, commands):
    validate_config(config)
    for name in ('imageRoot', 'jobsStateRoot'):
        private(config[name], True, jobs_owner(config) if name == 'jobsStateRoot' else config.get('sourceOwnerUid', os.getuid()))
    for name in ('backupRoot', 'stageRoot'):
        private(config[name], True)
    key = read_private(config['runtimeKey'], 32)
    if len(key) != 32:
        fail('Invalid runtime backup key')
    recovery_path = config.get('recoveryKeyCopy')
    if recovery_path and key != read_private(recovery_path, 32):
        fail('Runtime key and independently accessible recovery copy differ')
    # Availability/equality is verified here; physical off-device custody requires installation evidence.
    backup = Path(config['backupRoot'])
    checkpoint = backup / 'capture-state.json'
    if checkpoint.exists() and json.loads(read_private(checkpoint)).get('phase') != 'resumed':
        fail('Prior interrupted capture requires exact-state operator recovery; no automatic replay')
    token = secrets.token_hex(8)
    stage = Path(tempfile.mkdtemp(prefix='capture-', dir=config['stageRoot']))
    window = CaptureWindow(config, commands, checkpoint)
    entered = False
    try:
        entered = True
        try:
            window.enter()
            window.verify_frozen()
            bundle, manifest = capture_bundle(config, commands, stage)
            window.verify_frozen()
        finally:
            if entered and window.before:
                commands.periodic_resuming = True
                try:
                    with periodic.defer_signals():
                        window.restore() # Deadline/SIGTERM cannot interrupt exact resume.
                finally:
                    commands.periodic_resuming = False
        archive = backup / ('snapshot-' + token + '.tar.enc')
        codec = str(Path(__file__).with_name('backup-codec.mjs'))
        fingerprint = hashlib.sha256(read_private(config['runtimeKey'],32)).hexdigest()
        if fingerprint != manifest['recoveryKeyFingerprint']:
            fail('Runtime backup key changed during capture')
        commands.run(['node', codec, 'encrypt', str(bundle), str(archive), config['runtimeKey']], timeout=600)
        authenticated = stage / 'authenticated.tar'
        commands.run(['node', codec, 'decrypt', str(archive), str(authenticated), recovery_path or config['runtimeKey']], timeout=600)
        if hashlib.sha256(read_private(config['runtimeKey'],32)).hexdigest() != fingerprint:
            fail('Runtime backup key changed during verification')
        if file_hash(bundle) != file_hash(authenticated):
            fail('Authenticated archive plaintext differs')
        # Freshness is the proven source snapshot time, not a later verification clock.
        verified_at = manifest['capturedAt']
        restored = stage / 'restored'; restored.mkdir(mode=0o700)
        recovered = verified_extract(authenticated, restored, config['sourceId'])
        if recovered != manifest:
            fail('Authenticated manifest changed')
        checks = verify_restore(config, commands, restored, recovered)
        age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(verified_at)).total_seconds()
        if not 0 <= age < 35 * 60:
            fail('Verified snapshot became stale during independent restore; no fresh receipt')
        receipt = {'version': 1, 'sourceId': config['sourceId'], 'archiveSha256': file_hash(archive),
                   'verifiedAt': verified_at, 'restoreVerifiedAt': stamp(),
                   'databaseSystemIdentifier': manifest['databaseSystemIdentifier'], 'imageRoot': str(Path(config['imageRoot']).resolve()),
                   'independentRecoveryCopyChecked': bool(recovery_path)}
        if not config.get('periodic'): atomic_json(config['receiptFile'], receipt)
        return {'ok': True, 'sourceId': config['sourceId'], 'archive': archive.name,
                'receipt': receipt, 'verified': checks, 'writersResumedBeforeVerification': True,
                'independentRecoveryCopyChecked': bool(recovery_path), 'recoveryKeyFingerprint': fingerprint}
    finally:
        # Stage contains plaintext. Delete only this CLI's checked private child, never source files.
        if stage.parent.resolve() != Path(config['stageRoot']).resolve() or not stage.name.startswith('capture-'):
            fail('Private staging cleanup target changed')
        for parent, directories, files in os.walk(stage, topdown=False, followlinks=False):
            for name in files:
                (Path(parent) / name).unlink()
            for name in directories:
                (Path(parent) / name).rmdir()
        stage.rmdir()
        sync_directory(Path(config['stageRoot']))


def produce(config, commands=None):
    validate_config(config)
    root = private(config['backupRoot'], True)
    path = root / 'backup.lock'
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        private(path)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail('One backup producer already owns the capture window')
        selected = periodic.placement(config)
        commands = commands or LocalCommands({'profile': selected['name']})
        attempt = None
        try:
            if config.get('periodic') is not None:
                def publish_jobs(path, value):
                    atomic_jobs_json(path, value, periodic.actor(config)[1])
                attempt = periodic.Attempt(config, commands, atomic_json, file_hash, publish_jobs)
            result = produce_locked(config, commands)
            if attempt:
                attempt.finish(result)
                if selected['name'] == periodic.PC_PROFILE:
                    attempt.transfer_offsite(result)
            return result
        except BaseException:
            if attempt:
                with periodic.defer_signals(): attempt.hold()
            raise
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description='Explicit local DB/image snapshot; default validates only')
    parser.add_argument('--config', required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda _sig, _frame: fail('Capture interrupted; resume previous writer states'))
    try:
        config = json.loads(read_private(args.config))
        validate_config(config)
        if args.execute:
            result = produce(config)
            print(json.dumps({'ok': True, 'periodic': config.get('periodic') is not None,
                              'verifiedTables': result['verified']['databaseTables'], 'verifiedImages': result['verified']['images']}))
        else:
            print(json.dumps({'valid': True, 'executed': False, 'periodicEnabled': bool((config.get('periodic') or {}).get('enabled'))}))
    except Exception as error:
        # Never surface private psql rows, secrets, child output or config to logs.
        reason = str(error) if isinstance(error, BackupFailure) else 'Backup failed; publication requires inspection'
        if isinstance(error, periodic.Hold) and re.fullmatch(r'periodic-[a-z-]{1,64}', str(error)):
            reason = str(error)  # Code-owned finite enums; no config/child diagnostics.
        print(json.dumps({'ok': False, 'reason': reason}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
