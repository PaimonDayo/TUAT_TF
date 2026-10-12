"""Root oneshot policy. No daemon, endpoint discovery, replay, retention deletion or key logging."""
from contextlib import contextmanager
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import time

UNIT = 'tuat-local-backup.service'
TIMER = 'tuat-local-backup.timer'
SOCKET = 'unix:///var/run/docker.sock'
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

def read_json(path, private=True):
    p = immutable(path, private)
    need(p.stat().st_size <= 1048576, 'periodic-metadata-bound')
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
    need(set(value) == {'version', 'sourceId', 'sourceCommit', 'configSha256', 'sources', 'fragment',
                        'fragmentSha256', 'timer', 'timerSha256', 'execStart', 'nodePath', 'nodeSha256',
                        'runtimeConfigPath', 'runtimeConfigSha256'}, 'periodic-seal-keys')
    need(value['version'] == 1 and value['sourceId'] == config['sourceId'] and
         bool(re.fullmatch('[a-f0-9]{40}', value['sourceCommit'])), 'periodic-source-pin')
    need(digest(immutable(p['configPath'], True)) == value['configSha256'] and
         read_json(p['configPath']) == config, 'periodic-config-pin')
    required = {'backup.py', 'backup-codec.mjs', 'runtime.py', 'periodic.py'}
    need(isinstance(value['sources'], dict) and set(value['sources']) == required, 'periodic-source-set')
    base = Path(__file__).resolve().parent
    actual = {'backup.py': base / 'backup.py', 'backup-codec.mjs': base / 'backup-codec.mjs',
              'runtime.py': base / 'runtime.py', 'periodic.py': base / 'periodic.py'}
    for name, record in value['sources'].items():
        need(isinstance(record, dict) and set(record) == {'path', 'sha256'} and
             Path(record['path']) == actual[name] and digest(immutable(record['path'])) == record['sha256'], 'periodic-code-pin')
    for prefix in ('fragment', 'timer', 'nodePath', 'runtimeConfigPath'):
        hash_key = {'nodePath': 'nodeSha256', 'runtimeConfigPath': 'runtimeConfigSha256'}.get(prefix, prefix + 'Sha256')
        need(digest(immutable(value[prefix], prefix == 'runtimeConfigPath')) == value[hash_key], 'periodic-install-pin')
    need(Path(value['fragment']).name == UNIT and Path(value['timer']).name == TIMER and
         value['nodePath'] == '/opt/node-v24.19.0-linux-x64/bin/node', 'periodic-fixed-install')
    expected = '/usr/bin/python3 -I ' + str(actual['backup.py']) + ' --config ' + p['configPath'] + ' --execute'
    need(value['execStart'] == expected, 'periodic-exec-pin')
    return value

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
    need(stat.S_ISDIR(ms.st_mode) and ms.st_uid==0 and ms.st_gid==1000 and
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
            if text==config['jobsReceiptFile']:need(s.st_gid==1000, 'periodic-jobs-receipt-group')
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
            self.value.update(phase='verified', finishedAt=time.time(), receiptHash=expected_hash,jobsReceiptHash=expected_hash)
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
            self.published = True

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
