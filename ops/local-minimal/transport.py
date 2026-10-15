#!/usr/bin/env python3
"""Pinned, optional PC ingress transport. Observation never starts/stops/freezes it.

Private /var/lib/tuat-local/private/tunnel.json is the only opt-in. The token and
cloudflared configuration are root-only encrypted files, copied by systemd's
LoadCredential. Neither their bytes nor child output are diagnostics.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

sys.dont_write_bytecode = True
UNIT = 'tuat-local-tunnel.service'
MOUNT = Path('/var/lib/tuat-local')
POLICY = MOUNT / 'private/tunnel.json'
TOKEN = MOUNT / 'private/tunnel.token'
CONFIG = MOUNT / 'private/tunnel.yml'
BINARY = Path('/usr/bin/cloudflared')
FRAGMENT = Path('/etc/systemd/system') / UNIT
CREDENTIALS = '/run/credentials/' + UNIT
METRICS = '127.0.0.1:18305'
PROC = Path('/proc')
CGROUP = Path('/sys/fs/cgroup')
STATE_FIELDS = ('LoadState', 'ActiveState', 'SubState', 'FreezerState', 'MainPID', 'ControlPID', 'ControlGroup',
                'InvocationID', 'ExecMainStartTimestampMonotonic')
FIELDS = ('LoadState,Type,ActiveState,SubState,FreezerState,MainPID,ControlPID,ControlGroup,InvocationID,'
          'ExecMainStartTimestampMonotonic,FragmentPath,DropInPaths,User,Group,ExecStart,ExecStartPre,'
          'NoNewPrivileges,CapabilityBoundingSet,AmbientCapabilities,Environment,EnvironmentFiles,LoadCredential,'
          'ProtectSystem,ProtectHome,PrivateTmp,PrivateDevices,InaccessiblePaths,StandardOutput,StandardError,KillMode,Restart')


class Hold(RuntimeError):
    pass


def need(value, reason):
    if not value:
        raise Hold('transport-' + reason)


def sha(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1048576), b''):
            result.update(block)
    return result.hexdigest()


def immutable(path, private=False):
    p = Path(path)
    need(p.is_absolute() and p.resolve() == p and '..' not in p.parts, 'path')
    for parent in p.parents:
        info = parent.stat()
        need(info.st_uid == 0 and stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o022, 'parent')
    info = p.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and
         (stat.S_IMODE(info.st_mode) == 0o600 if private else not info.st_mode & 0o022), 'file')
    if private:
        need(info.st_dev == MOUNT.stat().st_dev, 'encrypted-device')
    return p


def policy(context):
    if context.get('profile') != 'pc-private':
        return None
    if not POLICY.exists():
        need(not POLICY.is_symlink(), 'policy-symlink')
        return None
    p = immutable(POLICY, True)
    need(p.stat().st_size <= 4096, 'policy-bound')
    value = json.loads(p.read_bytes())
    need(isinstance(value, dict) and value.get('version') == 1 and type(value.get('enabled')) is bool and
         value.get('sourceId') == context.get('sourceId'), 'policy')
    keys = {'version', 'enabled', 'sourceId'}
    if value['enabled']:
        keys |= {'unitSha256', 'binarySha256', 'configSha256', 'tokenSha256'}
    need(set(value) == keys, 'policy-keys')
    if value['enabled']:
        private = POLICY.parent.stat()
        need(private.st_uid == 0 and stat.S_IMODE(private.st_mode) == 0o700, 'private-directory')
        for name, path, secret in (('unit', FRAGMENT, False), ('binary', BINARY, False),
                                   ('config', CONFIG, True), ('token', TOKEN, True)):
            expected = value[name + 'Sha256']
            need(isinstance(expected, str) and re.fullmatch('[a-f0-9]{64}', expected), 'pin-shape')
            protected = immutable(path, secret)
            if secret:
                need(0 < protected.stat().st_size <= 65536, 'credential-bound')
            need(sha(protected) == expected, 'file-pin')
    return value


def argv():
    return [str(BINARY), 'tunnel', '--config', CREDENTIALS + '/config', '--no-autoupdate',
            '--protocol', 'quic', '--metrics', METRICS, '--loglevel', 'warn',
            'run', '--token-file', CREDENTIALS + '/token']


def properties(commands):
    raw = commands.run(['systemctl', 'show', UNIT, '--property=' + FIELDS])
    if isinstance(raw, bytes):
        raw = raw.decode()
    need(len(raw) <= 16384, 'systemd-bound')
    pairs = [line.split('=', 1) for line in raw.splitlines() if '=' in line]
    props = {}
    for key, value in pairs:
        # systemctl emits one ExecStartPre= line per command on systemd 255.
        # Preserve every entry; the exact two-command contract is checked below.
        need(key not in props or key == 'ExecStartPre', 'systemd-duplicates')
        props[key] = props[key] + ' ' + value if key in props else value
    return props


def structured_property(commands, name, signature):
    # systemctl renders structured properties as [unprintable], or omits empty
    # vectors, on systemd 255. Read their typed D-Bus representation instead.
    raw = commands.run(['/usr/bin/busctl', '--json=short', 'get-property', 'org.freedesktop.systemd1',
        '/org/freedesktop/systemd1/unit/tuat_2dlocal_2dtunnel_2eservice', 'org.freedesktop.systemd1.Service', name])
    need(len(raw) <= 8192, 'credential-metadata-bound')
    value = json.loads(raw)
    need(isinstance(value, dict) and value.get('type') == signature and isinstance(value.get('data'), list), 'credential-metadata')
    return value['data']


def credential_sources(commands):
    # LoadCredential contains names/source paths, never credential file contents.
    rows = structured_property(commands, 'LoadCredential', 'a(ss)')
    need(len(rows) == 2 and all(isinstance(row, list) and len(row) == 2 and
         all(isinstance(item, str) for item in row) for row in rows) and
         len({row[0] for row in rows}) == len(rows), 'credential-metadata')
    return dict(rows)


def process_identity(pid, group, value):
    process = PROC / pid
    before = (process/'stat').read_text().rsplit(')', 1)[1].split()[19]
    need(re.fullmatch('[1-9][0-9]*', before), 'process-birth')
    need((process/'cgroup').read_text().strip() == '0::' + group, 'process-cgroup')
    need((CGROUP / group.lstrip('/') / 'cgroup.procs').read_text().split() == [pid], 'cgroup-processes')
    need([a.decode() for a in (process/'cmdline').read_bytes().split(b'\0') if a] == argv(), 'process-argv')
    status = dict(line.split(':', 1) for line in (process/'status').read_text().splitlines() if ':' in line)
    need(status.get('Uid', '').split() == ['65532'] * 4 and status.get('Gid', '').split() == ['65532'] * 4 and
         status.get('Groups', '').split() in ([], ['65532']) and status.get('NoNewPrivs', '').strip() == '1' and
         all(status.get(key, '').strip() == '0000000000000000' for key in
             ('CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb')), 'process-privilege')
    need(sha(process/'exe') == value['binarySha256'], 'process-binary-pin')
    environment = (process/'environ').read_bytes()
    need(len(environment) <= 65536, 'process-environment-bound')
    env = [entry.split(b'=', 1) for entry in environment.split(b'\0') if entry]
    allowed_env = {b'PATH', b'HOME', b'USER', b'LOGNAME', b'SHELL', b'LANG', b'INVOCATION_ID',
                   b'SYSTEMD_EXEC_PID', b'CREDENTIALS_DIRECTORY', b'JOURNAL_STREAM', b'MEMORY_PRESSURE_WATCH',
                   b'MEMORY_PRESSURE_WRITE'}
    need(all(len(row) == 2 and row[0] in allowed_env for row in env), 'process-environment')
    need(dict(env).get(b'CREDENTIALS_DIRECTORY') == CREDENTIALS.encode(), 'credential-directory')
    for name in ('token', 'config'):
        # /proc/PID/root is an intentional kernel namespace reference; the final
        # credential itself must be a regular private file, never a symlink.
        path = process / 'root' / CREDENTIALS.lstrip('/') / name
        info = path.lstat()
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 65532 and stat.S_IMODE(info.st_mode) == 0o400 and
             0 < info.st_size <= 65536 and sha(path) == value[name + 'Sha256'], 'live-credential-pin')
    need((process/'stat').read_text().rsplit(')', 1)[1].split()[19] == before, 'process-replaced')
    return before


def observe(context, commands, listed):
    """Return a comparable identity, preserving absent/disabled installations."""
    try:
        value = policy(context)
        enabled = value is not None and value['enabled']
        need(context.get('profile') == 'pc-private' or not listed, 'profile')
        if not listed:
            need(not enabled, 'unit-inventory')
            return {'policy': value, 'unit': None}
        props = properties(commands)
        need(props.get('LoadState') == 'loaded' and props.get('FreezerState') == 'running' and
             props.get('ControlPID') == '0', 'unit-state')
        active = props.get('ActiveState') == 'active'
        if not active:
            need(props.get('ActiveState') == 'inactive' and props.get('SubState') == 'dead' and
                 props.get('MainPID') == '0' and props.get('ControlGroup') == '', 'inactive-state')
        else:
            need(enabled and props.get('SubState') == 'running' and
                 re.fullmatch('[1-9][0-9]*', props.get('MainPID', '')) and
                 re.fullmatch('[a-f0-9]{32}', props.get('InvocationID', '')) and
                 re.fullmatch('[1-9][0-9]*', props.get('ExecMainStartTimestampMonotonic', '')) and
                 props.get('ControlGroup') == '/system.slice/' + UNIT, 'active-state')
        sources = None
        if enabled:
            need(props.get('FragmentPath') == str(FRAGMENT) and props.get('DropInPaths') == '' and
                 props.get('User') == '65532' and props.get('Group') == '65532' and
                 props.get('NoNewPrivileges') == 'yes' and props.get('CapabilityBoundingSet') == '' and
                 props.get('AmbientCapabilities') == '' and
                 props.get('Environment') == 'HOME=/nonexistent PATH=/usr/bin:/bin', 'unit-contract')
            sources = credential_sources(commands)
            need(sources == {'token':str(TOKEN), 'config':str(CONFIG)}, 'unit-credentials')
            need(structured_property(commands, 'EnvironmentFiles', 'a(sb)') == [], 'unit-environment-files')
            contract = {'Type': 'exec',
                        'ProtectSystem': 'strict', 'ProtectHome': 'yes', 'PrivateTmp': 'yes', 'PrivateDevices': 'yes',
                        'InaccessiblePaths': str(MOUNT), 'StandardOutput': 'null', 'StandardError': 'null',
                        'KillMode': 'control-group', 'Restart': 'on-failure'}
            need(all(props.get(key) == expected for key, expected in contract.items()), 'unit-sandbox')
            starts = re.findall(r'argv\[\]=(.*?) ;', props.get('ExecStart', ''))
            need(starts == [' '.join(argv())], 'unit-exec')
            starts = re.findall(r'argv\[\]=(.*?) ;', props.get('ExecStartPre', ''))
            need(starts == ['/usr/bin/findmnt --noheadings --mountpoint /var/lib/tuat-local --source /dev/mapper/tuat-local-data --types ext4',
                            '/usr/bin/python3 -I /opt/tuat-local-runtime/transport.py --preflight'], 'unit-preflight')
        birth = process_identity(props['MainPID'], props['ControlGroup'], value) if active else None
        if active:
            text = commands.run(['ss', '-H', '-ltnp', 'sport = :18305'])
            if isinstance(text, bytes): text = text.decode()
            lines = text.splitlines()
            need(len(lines) == 1 and len(lines[0].split()) >= 5 and lines[0].split()[3] == METRICS and
                 re.findall(r'pid=([0-9]+)', lines[0]) == [props['MainPID']], 'metrics-boundary')
        # Re-observe after /proc and listener checks so restart/PID reuse cannot
        # combine properties from one invocation with another process.
        need(properties(commands) == props, 'unit-replaced')
        if enabled:
            need(credential_sources(commands) == sources, 'credentials-replaced')
            need(structured_property(commands, 'EnvironmentFiles', 'a(sb)') == [], 'unit-environment-files')
        return {'policy': value, 'unit': props if enabled else {key: props.get(key) for key in STATE_FIELDS}, 'processBirth': birth,
                **({'credentialSources': sources} if enabled else {})}
    except Hold:
        raise
    except Exception:
        raise Hold('transport-observation-failed') from None


def main():
    # This root preflight is fixed in the unit and deliberately prints nothing.
    try:
        need(sys.argv[1:] == ['--preflight'] and os.geteuid() == 0, 'preflight')
        runtime = immutable('/etc/tuat-local/runtime.json')
        need(stat.S_IMODE(runtime.stat().st_mode) == 0o600 and runtime.stat().st_size <= 65536, 'runtime-bound')
        context = json.loads(runtime.read_bytes())
        value = policy(context)
        need(value is not None and value['enabled'], 'disabled')
        return 0
    except Exception:
        return 1


if __name__ == '__main__':
    sys.exit(main())
