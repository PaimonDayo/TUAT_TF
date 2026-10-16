"""Linux root only: real private mount/net namespaces, synthetic DNS, no providers.

Run with python3 -I -B ops/pc-host/linux-application-sandbox.test.py.
All /etc, /mnt and legacy-backend fixture mounts exist only in owned namespaces.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import unittest

SCRIPT = Path(__file__).with_name('linux-application-sandbox.sh')
RESOLVER = b'nameserver 127.0.0.1\noptions timeout:1 attempts:1\n'


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, timeout=10)


def host_state():
    path = Path('/etc/resolv.conf')
    return (os.readlink('/proc/self/ns/mnt'), Path('/proc/self/mountinfo').read_bytes(),
            path.is_symlink(), os.readlink(path) if path.is_symlink() else None,
            path.read_bytes())


PROBE = r'''
import errno,hashlib,json,os,socket,sys
from pathlib import Path
mode,expected=sys.argv[1:]
assert os.getuid()==65530 and os.getgid()==65530 and os.getgroups()==[]
status=Path('/proc/self/status').read_text()
fields=dict(line.split(':',1) for line in status.splitlines() if ':' in line)
assert int(fields['CapEff'].strip(),16)==0 and int(fields['CapBnd'].strip(),16)==0
assert fields['NoNewPrivs'].strip()=='1'
assert hashlib.sha256(Path('/etc/resolv.conf').read_bytes()).hexdigest()==expected
assert socket.getaddrinfo('resolver.fixture.invalid',80,socket.AF_INET)[0][4][0]=='127.0.0.42'
for path in ('/mnt/c/secret','/mnt/wsl/other-secret','/opt/tuat-tf-supabase/secret'):
    assert not Path(path).exists(),path
assert list(Path('/opt/tuat-tf-supabase').iterdir())==[]
if mode=='wsl':
    assert list(Path('/mnt').iterdir())==[Path('/mnt/wsl')]
    assert list(Path('/mnt/wsl').iterdir())==[Path('/mnt/wsl/resolv.conf')]
    try:
        with open('/etc/resolv.conf','ab') as stream: stream.write(b'must not change')
    except OSError as error: assert error.errno in (errno.EROFS,errno.EACCES)
    else: raise AssertionError('Resolver remained writable')
    row=next(line for line in Path('/proc/self/mountinfo').read_text().splitlines()
             if line.split()[4]=='/mnt/wsl/resolv.conf')
    assert {'ro','nosuid','nodev','noexec'}<=set(row.split()[5].split(','))
else: assert list(Path('/mnt').iterdir())==[]
os.write(3,b'ipc-preserved')
try: os.fstat(9)
except OSError as error: assert error.errno==errno.EBADF
else: raise AssertionError('Resolver descriptor leaked')
print(json.dumps({'dnsResolved':True,'isolated':True,'unprivileged':True}))
'''


def fixture(mode):
    # Read source before hiding the worktree's /mnt/d mount. The actual script
    # runs unchanged from a root-owned temporary copy outside the hidden tree.
    source = SCRIPT.read_bytes().replace(b'\r\n', b'\n')
    with tempfile.TemporaryDirectory(prefix='tuat-sandbox-dns-') as directory:
        root = Path(directory); root.chmod(0o755)
        script = root/'sandbox.sh'; script.write_bytes(source); script.chmod(0o755)
        for target in ('/etc', '/mnt', '/opt'):
            run('/usr/bin/mount','-t','tmpfs','-o','mode=0755,nosuid,nodev','tmpfs',target)
        Path('/mnt/c').mkdir(); Path('/mnt/wsl').mkdir()
        Path('/opt/tuat-tf-supabase').mkdir()
        markers = [Path('/mnt/c/secret'),Path('/mnt/wsl/other-secret'),Path('/opt/tuat-tf-supabase/secret')]
        for path in markers: path.write_bytes(b'synthetic secret marker')
        resolver = Path('/mnt/wsl/resolv.conf')
        if mode == 'regular': resolver = Path('/etc/resolv.conf')
        if mode in ('external','alias-external'): resolver = root/'outside-resolv.conf'
        if mode != 'missing': resolver.write_bytes(RESOLVER); resolver.chmod(0o666)
        if mode != 'regular':
            target='/mnt/c/secret' if mode=='unsupported' else resolver
            if mode in ('alias-wsl','alias-external'):
                Path('/mnt/wsl/alias').symlink_to(resolver);target='/mnt/wsl/alias'
            Path('/etc/resolv.conf').symlink_to(target)
        # The synthetic WSL source is writable deliberately: the child must
        # still get a read-only mount, not merely an inode permission denial.
        before = host_state() if mode != 'missing' else None
        run('/usr/sbin/ip','link','set','lo','up')
        server = socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
        server.bind(('127.0.0.1',53)); server.settimeout(0.1)
        stopped = threading.Event()
        def dns():
            while not stopped.is_set():
                try: packet,address=server.recvfrom(4096)
                except socket.timeout: continue
                end=12
                while packet[end]: end+=packet[end]+1
                end+=5
                question=packet[12:end]
                # One synthetic A record; never send a packet outside loopback.
                answer=b'\xc0\x0c'+struct.pack('!HHIH',1,1,30,4)+socket.inet_aton('127.0.0.42')
                response=packet[:2]+struct.pack('!HHHHH',0x8180,1,1,0,0)+question+answer
                server.sendto(response,address)
        worker=threading.Thread(target=dns);worker.start()
        ipc_parent,ipc_child=socket.socketpair();ipc_parent.settimeout(2)
        try:
            launch="import os,sys;fd=int(sys.argv[1]);os.dup2(fd,3);os.close(fd) if fd!=3 else None;os.execv(sys.argv[2],sys.argv[2:])"
            result=subprocess.run(['/usr/bin/python3','-I','-B','-c',launch,str(ipc_child.fileno()),
                '/usr/bin/unshare','--mount','--propagation','private',
                '/bin/sh',str(script),'65530','65530','/usr/bin/python3','-I','-B','-c',PROBE,
                mode,hashlib.sha256(RESOLVER).hexdigest()],capture_output=True,timeout=15,pass_fds=(ipc_child.fileno(),))
            ipc_child.close()
            if mode not in ('missing','unsupported','alias-wsl','alias-external'): assert ipc_parent.recv(64)==b'ipc-preserved'
        finally:
            stopped.set();worker.join(timeout=2);server.close()
            ipc_parent.close();ipc_child.close()
        if mode in ('missing','unsupported','alias-wsl','alias-external'):
            assert result.returncode==65,(result.returncode,result.stderr.decode())
            assert result.stdout==b''
        else:
            assert result.returncode==0,result.stderr.decode()
            assert json.loads(result.stdout)['dnsResolved'] is True
            assert host_state()==before,'Sandbox changed its parent mounts or resolver'
        for path in markers: assert path.read_bytes()==b'synthetic secret marker'
        if mode!='missing': assert resolver.read_bytes()==RESOLVER
        print(json.dumps({'mode':mode,'passed':True,'parentUnchanged':True}))


@unittest.skipUnless(sys.platform=='linux' and os.getuid()==0,'Linux root mount/net namespace test')
class SandboxDnsTests(unittest.TestCase):
    def test_real_namespace_resolver_and_isolation(self):
        for mode in ('wsl','regular','external','missing','unsupported','alias-wsl','alias-external'):
            with self.subTest(mode=mode):
                before=host_state()
                child=subprocess.Popen(['/usr/bin/unshare','--mount','--net','--propagation','private',
                    '/usr/bin/python3','-I','-B',str(Path(__file__).resolve()),'--fixture',mode],
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
                try: output,error=child.communicate(timeout=25)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid,signal.SIGKILL);child.communicate()
                    self.fail('Owned synthetic namespace exceeded deadline')
                self.assertEqual(child.returncode,0,error.decode())
                self.assertTrue(json.loads(output)['parentUnchanged'])
                self.assertEqual(host_state(),before,'Test changed the host mount namespace or resolver')


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--fixture': fixture(sys.argv[2])
    else: unittest.main()
