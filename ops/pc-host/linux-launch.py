"""Root lifetime lock launcher. Fixed Node/service entry points; no service installation."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid

NODE = Path('/opt/node-v24.19.0-linux-x64/bin/node')
ENTRIES = {'app': 'ops/pc-host/run.mjs', 'jobs': 'ops/pc-jobs/run.mjs'}

class Hold(RuntimeError):
    pass

class QuietParser(argparse.ArgumentParser):
    def error(self, message):
        print('{"started":false,"hold":"linux-launch-interface"}', file=sys.stderr)
        raise SystemExit(2)

def need(value):
    if not value:
        raise Hold('Linux lifetime owner could not be verified')

def protected(path, directory=False, private=False):
    p = Path(path)
    need(p.is_absolute() and '..' not in p.parts and p.resolve() == p)
    for parent in p.parents:
        s = parent.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022)
    s = p.lstat()
    need((stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)) and s.st_uid == 0 and
         not s.st_mode & 0o022 and (directory or s.st_nlink == 1) and
         (not private or stat.S_IMODE(s.st_mode) == (0o700 if directory else 0o600)))
    return p, s

def signature(s):
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns

def private_config(path):
    p, before = protected(path, private=True)
    protected(p.parent, directory=True, private=True)
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        need(signature(os.fstat(fd)) == signature(before) and before.st_size <= 1048576)
        data = os.read(fd, 1048577)
        need(len(data) == before.st_size and signature(os.fstat(fd)) == signature(before) and
             signature(p.lstat()) == signature(before))
        result = json.loads(data)
        need(isinstance(result, dict))
        return result
    finally:
        os.close(fd)

def launch(service, config_path, node_sha256):
    need(sys.platform == 'linux' and os.geteuid() == 0 and service in ENTRIES and
         bool(re.fullmatch('[a-f0-9]{64}', node_sha256)))
    config = private_config(config_path)
    config_stamp = signature(Path(config_path).lstat())
    need(config.get('version') == 1 and config.get('enabled') is True)
    release, _ = protected(config.get('releaseDirectory', ''), directory=True)
    state, _ = protected(config.get('stateDirectory', ''), directory=True, private=True)
    need(state != release and release not in state.parents)
    own, _ = protected(release / 'ops/pc-host/linux-launch.py')
    need(own == Path(__file__).resolve())
    entry, entry_stat = protected(release / ENTRIES[service])
    protected(config.get('environmentFile', ''), private=True)
    protected(Path(config['environmentFile']).parent, directory=True, private=True)
    node, node_stat = protected(NODE)
    need(node_stat.st_mode & 0o111 and hashlib.sha256(node.read_bytes()).hexdigest() == node_sha256)
    path = state / 'lifetime.lock'
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        opened = os.fstat(fd)
        need(stat.S_ISREG(opened.st_mode) and opened.st_uid == 0 and opened.st_nlink == 1 and
             stat.S_IMODE(opened.st_mode) == 0o600 and signature(path.lstat()) == signature(opened))
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(signature(path.lstat()) == signature(os.fstat(fd)))
        need(signature(protected(config_path, private=True)[1]) == config_stamp and
             signature(protected(node)[1]) == signature(node_stat) and
             signature(protected(entry)[1]) == signature(entry_stat))
        owner = {'version': 1, 'service': service, 'pid': os.getpid(), 'ownerId': str(uuid.uuid4()),
                 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        encoded = json.dumps(owner).encode()
        os.ftruncate(fd, 0); os.lseek(fd, 0, os.SEEK_SET)
        need(os.write(fd, encoded) == len(encoded)); os.fsync(fd)
        need(signature(path.lstat()) == signature(os.fstat(fd)))
        # Do not accept inherited fake mutex/descriptor claims. Only this held FD crosses exec.
        # Node reads its dedicated config/env itself. No inherited NODE_OPTIONS,
        # NODE_PATH, proxy/provider credentials, Docker context or fake guard.
        environment = {'PATH': '/opt/node-v24.19.0-linux-x64/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8',
                       'HOME': '/root', 'TMPDIR': '/tmp'}
        environment.update(TUAT_PC_LINUX_LOCK_FD=str(fd), TUAT_PC_LINUX_LOCK_SERVICE=service,
                           TUAT_PC_LINUX_LOCK_PATH=str(path))
        os.set_inheritable(fd, True)
        os.chdir(release)
        arguments = [str(node), str(entry), *([str(Path(config_path)), '--execute'] if service == 'app' else ['--run', str(Path(config_path))])]
        os.execve(node, arguments, environment)
    finally:
        os.close(fd)  # Successful exec keeps the descriptor and lock for Node's entire lifetime.

def main():
    parser = QuietParser(description='Fixed root PC app/Jobs lifetime launcher')
    parser.add_argument('--service', choices=ENTRIES, required=True)
    parser.add_argument('--config', required=True)
    parser.add_argument('--node-sha256', required=True)
    args = parser.parse_args()
    try:
        launch(args.service, args.config, args.node_sha256)
    except Exception:
        print('{"started":false,"hold":"linux-lifetime-unverified"}', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
