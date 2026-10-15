import importlib.util
import hashlib
import json
from pathlib import Path
import posixpath
import shutil
import stat
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('bootstrap', Path(__file__).with_name('bootstrap.py'))
boot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot)


class DiskBootTests(unittest.TestCase):
    def setUp(self):
        self.config = {'backingFile': '/var/lib/tuat-local-data-20261013.luks'}
        self.backing = Mock()
        self.backing.__str__ = Mock(return_value=self.config['backingFile'])
        self.backing.lstat.return_value = Mock(st_dev=3, st_ino=4, st_size=5)
        self.directory = Mock()
        self.directory.is_symlink.return_value = False
        self.directory.is_dir.return_value = True
        self.directory.stat.return_value = Mock(st_uid=0)
        self.directory.iterdir.return_value = iter([])

    def test_existing_mount_is_observed_without_reopening_or_remounting(self):
        command = Mock()
        with patch.object(boot, 'storage_identity', return_value=(self.backing, (3, 4, 5))), \
             patch.object(boot, 'mapping', return_value='/dev/loop9'), \
             patch.object(boot, 'mounted', return_value=True):
            result = boot.open_existing(self.config, bytearray(b'x'*32), True, command)
        self.assertEqual(result, {'opened': False, 'mounted': False})
        command.assert_not_called()


    def test_check_never_unblocks_or_mounts_a_closed_disk(self):
        command = Mock()
        with patch.object(boot, 'storage_identity', return_value=(self.backing, (3, 4, 5))), \
             patch.object(boot, 'mapping', return_value=None), \
             patch.object(boot, 'mounted', return_value=False):
            with self.assertRaisesRegex(boot.Held, 'storage-not-mounted'):
                boot.open_existing(self.config, bytearray(), False, command)
        command.assert_not_called()

    def test_wrong_existing_mapping_fails_without_touching_disk(self):
        command = Mock()
        with patch.object(boot, 'storage_identity', return_value=(self.backing, (3, 4, 5))), \
             patch.object(boot, 'mapping', side_effect=boot.Held('loop-backing')):
            with self.assertRaisesRegex(boot.Held, 'loop-backing'):
                boot.open_existing(self.config, bytearray(b'x'*32), True, command)
        command.assert_not_called()

    def test_existing_files_below_unmounted_target_are_preserved(self):
        self.directory.iterdir.return_value = iter(['important-data'])
        command = Mock()
        with patch.object(boot, 'storage_identity', return_value=(self.backing, (3, 4, 5))), \
             patch.object(boot, 'mapping', return_value=None), \
             patch.object(boot, 'mounted', return_value=False), \
             patch.object(boot, 'Path', return_value=self.directory):
            with self.assertRaisesRegex(boot.Held, 'mountpoint-not-empty'):
                boot.open_existing(self.config, bytearray(b'x'*32), True, command)
        command.assert_not_called()

    def test_orphan_loop_is_not_reused_or_detached(self):
        command = Mock(return_value=(0, '{"loopdevices":[{"name":"/dev/loop2"}]}'))
        with patch.object(boot, 'storage_identity', return_value=(self.backing, (3, 4, 5))), \
             patch.object(boot, 'mapping', return_value=None), \
             patch.object(boot, 'mounted', return_value=False), \
             patch.object(boot, 'Path', return_value=self.directory):
            with self.assertRaisesRegex(boot.Held, 'unowned-existing-loop'):
                boot.open_existing(self.config, bytearray(b'x'*32), True, command)
        self.assertEqual(command.call_count, 1)

    def test_successful_cold_open_never_formats_or_stops_services(self):
        calls = []
        def command(arguments, **kwargs):
            calls.append((arguments, kwargs))
            return 0, '{"loopdevices":[]}'
        with patch.object(boot, 'storage_identity', return_value=(self.backing, (3, 4, 5))), \
             patch.object(boot, 'mapping', side_effect=[None, '/dev/loop9']), \
             patch.object(boot, 'mounted', side_effect=[False, True]), \
             patch.object(boot, 'Path', return_value=self.directory):
            result = boot.open_existing(self.config, bytearray(b'x'*32), True, command)
        self.assertEqual(result, {'opened': True, 'mounted': True})
        self.assertEqual([call[0][0] for call in calls], ['/usr/sbin/losetup', '/usr/sbin/cryptsetup', '/usr/bin/mount'])
        self.assertEqual(calls[1][1]['data'], bytearray(b'x'*32))
        self.assertNotIn(b'x'*32, repr(calls[1][0]).encode())

    def test_unknown_open_outcome_is_not_repeated_or_rolled_back(self):
        command = Mock(side_effect=[(0, '{"loopdevices":[]}'), subprocess.TimeoutExpired('cryptsetup', 45)])
        with patch.object(boot, 'storage_identity', return_value=(self.backing, (3, 4, 5))), \
             patch.object(boot, 'mapping', return_value=None), \
             patch.object(boot, 'mounted', return_value=False), \
             patch.object(boot, 'Path', return_value=self.directory):
            with self.assertRaises(subprocess.TimeoutExpired):
                boot.open_existing(self.config, bytearray(b'x'*32), True, command)
        self.assertEqual(command.call_count, 2)

    def test_disabled_boot_policy_starts_nothing(self):
        command = Mock()
        with self.assertRaisesRegex(boot.Held, 'boot-policy'):
            boot.start_installed({}, {'version': 1, 'enabled': False, 'automaticBackups': False}, command)
        command.assert_not_called()


class SyntheticStart:
    """Fixed deployment metadata and service observations; no host paths are read."""
    def __init__(self, jobs=False, timer=False, tunnel=True):
        self.events, self.running = [], set()
        self.jobs, self.tunnel, self.timer = jobs, tunnel, timer
        self.version = 'a'*40
        self.release = '/var/lib/tuat-local/releases/'+'b'*40
        self.runtime = self.release+'/ops/local-minimal/runtime.py'
        self.paths = {'containerdConfig':'/etc/tuat-local/containerd.toml', 'dockerConfig':'/etc/tuat-local/docker.json',
                      'containerdUnit':'/etc/systemd/system/tuat-local-containerd.service',
                      'dockerUnit':'/etc/systemd/system/tuat-local-docker.service'}
        self.config = {'releaseDirectory':self.release, 'jobsConfig':'/synthetic/jobs.json', 'hostConfigPath':'/synthetic/host.json',
            'daemonSeal':{field:hashlib.sha256(path.encode()).hexdigest() for field,path in self.paths.items()}}
        self.policy = {'version':1, 'enabled':True, 'automaticBackups':timer}
        self.fail_storage = False

    def path(self, value):
        fixture = self
        class ObservedPath:
            def __init__(self, name): self.name = str(name)
            def __str__(self): return self.name
            def __truediv__(self, child): return ObservedPath(posixpath.join(self.name,str(child)))
            def __eq__(self, other): return self.name == str(other)
            def is_file(self): return True
            def is_symlink(self): return False
            def resolve(self): return self
            def exists(self):
                assert self.name == boot.MOUNT+'/private/tunnel.json'
                return fixture.tunnel
            def stat(self): return self.lstat()
            def lstat(self):
                mode = 0o600 if self.name.endswith(('.json','.toml')) else 0o644
                return SimpleNamespace(st_uid=0,st_nlink=1,st_mode=stat.S_IFREG|mode)
            def read_bytes(self): return self.name.encode()
        return ObservedPath(value)

    def private(self, path):
        if path == self.config['jobsConfig']: return json.dumps({'enabled':self.jobs}).encode()
        if path == self.config['hostConfigPath']: return json.dumps({'releaseCommit':self.version}).encode()
        if path == boot.MOUNT+'/private/tunnel.json': return b'{"enabled":true}'
        raise AssertionError('Unexpected private input')

    def command(self, args, **_kwargs):
        if args[:2] == ['/usr/bin/systemctl','show']:
            name = args[2]; self.events.append('show:'+name)
            return 0, '\n'.join('='.join(pair) for pair in dict(LoadState='loaded',FragmentPath='/etc/systemd/system/'+name,
                DropInPaths='',ControlPID='0',ActiveState='active' if name in self.running else 'inactive',
                SubState='running' if name in self.running else 'dead').items())
        if args[:2] == ['/usr/bin/systemctl','start']:
            name = args[2]; self.events.append('start:'+name); self.running.add(name)
            return 0, ''
        if args == ['/usr/bin/python3','-I','-B','/opt/tuat-local-runtime/transport.py','--preflight']:
            self.events.append('transport-preflight'); return 0, ''
        if args == ['/usr/bin/python3','-I','-B',self.runtime,'--storage-only',boot.CONFIG]:
            assert set(boot.UNITS[:2]) <= self.running
            assert boot.UNITS[2] not in self.running
            self.events.append('storage-only')
            if self.fail_storage: raise boot.Held('synthetic-storage-gate')
            return 0, '{"valid":true}'
        if args == ['/usr/bin/python3','-I','-B',self.runtime,'--check',boot.CONFIG]:
            assert 'version-ready' in self.events
            assert set(boot.UNITS) <= self.running
            self.events.append('runtime-check'); return 0, '{"valid":true}'
        raise AssertionError('Unexpected command')

    def connection(self, host, port, **_kwargs):
        assert host == '127.0.0.1' and port == 18201
        def request(method, path):
            assert method == 'GET' and path == '/api/version'
            assert boot.UNITS[2] in self.running
            self.events.append('version-ready')
        # Startup checks a pinned process/version, without treating the fresh
        # boot's missing backup receipt as a failed application start.
        return SimpleNamespace(request=request, close=lambda:None,
            getresponse=lambda:SimpleNamespace(status=200,read=lambda _bound:json.dumps({'version':self.version}).encode()))

    def start(self):
        with patch.object(boot,'Path',side_effect=self.path), patch.object(boot,'private_file',side_effect=self.private), \
             patch.object(boot.http.client,'HTTPConnection',side_effect=self.connection):
            boot.start_installed(self.config,self.policy,self.command)


class InstalledStartTests(unittest.TestCase):
    def test_cold_boot_checks_static_seals_primes_transport_and_starts_daemons_before_runtime_gate(self):
        for jobs, timer in ((False,False),(True,True)):
            with self.subTest(jobs=jobs,timer=timer):
                fixture = SyntheticStart(jobs,timer); fixture.start()
                start = lambda name:fixture.events.index('start:'+name)
                self.assertLess(fixture.events.index('transport-preflight'),fixture.events.index('show:tuat-local-tunnel.service'))
                self.assertLess(fixture.events.index('show:tuat-local-tunnel.service'),start(boot.UNITS[2]))
                self.assertLess(start(boot.UNITS[0]),start(boot.UNITS[1]))
                self.assertLess(start(boot.UNITS[1]),fixture.events.index('storage-only'))
                self.assertLess(fixture.events.index('storage-only'),start(boot.UNITS[2]))
                self.assertLess(start(boot.UNITS[2]),fixture.events.index('version-ready'))
                self.assertLess(fixture.events.index('version-ready'),fixture.events.index('runtime-check'))
                self.assertLess(fixture.events.index('runtime-check'),start('tuat-local-tunnel.service'))
                self.assertEqual('tuat-local-jobs.service' in fixture.running,jobs)
                self.assertEqual('tuat-local-backup.timer' in fixture.running,timer)
                if jobs: self.assertLess(fixture.events.index('runtime-check'),start('tuat-local-jobs.service'))
                if timer: self.assertLess(start('tuat-local-tunnel.service'),start('tuat-local-backup.timer'))

    def test_changed_daemon_unit_pin_starts_nothing(self):
        fixture = SyntheticStart(); fixture.config['daemonSeal']['dockerUnit'] = '0'*64
        with self.assertRaisesRegex(boot.Held,'daemon-static-seal'): fixture.start()
        self.assertEqual(fixture.events,[])

    def test_failed_storage_gate_keeps_started_daemons_and_does_not_start_app_or_transport(self):
        fixture = SyntheticStart(); fixture.fail_storage = True
        with self.assertRaisesRegex(boot.Held,'synthetic-storage-gate'): fixture.start()
        self.assertEqual(fixture.running,set(boot.UNITS[:2]))
        self.assertFalse(any(event.startswith('stop:') for event in fixture.events))

    def test_absent_transport_and_disabled_jobs_add_no_service_requirement(self):
        fixture = SyntheticStart(tunnel=False); fixture.start()
        self.assertEqual(fixture.running,set(boot.UNITS))
        self.assertNotIn('transport-preflight',fixture.events)
        self.assertFalse(any('tunnel' in event or 'jobs' in event or '.timer' in event for event in fixture.events))

    def test_windows_key_buffer_is_zeroed_only_after_delayed_pipe_write_callback(self):
        node = '/opt/node-v24.19.0-linux-x64/bin/node'
        if not Path(node).is_file(): node = shutil.which('node')
        if not node: self.skipTest('Node unavailable')
        module = Path(__file__).with_name('windows-boot.mjs').resolve().as_uri()
        script = '''
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
const {sendKey}=await import(MODULE);
const stdin=new EventEmitter();let written,completed;
stdin.end=(value,callback)=>{written=value;completed=callback;};
const key=Buffer.alloc(32,97);sendKey({stdin},key);
assert.equal(written,key);assert.deepEqual(written,Buffer.alloc(32,97));
completed();assert.deepEqual(key,Buffer.alloc(32));
const broken=new EventEmitter();broken.end=()=>{};
const second=Buffer.alloc(32,98);sendKey({stdin:broken},second);broken.emit('error',Error('synthetic pipe failure'));
assert.deepEqual(second,Buffer.alloc(32));
'''.replace('MODULE',json.dumps(module))
        result = subprocess.run([node,'--input-type=module','-e',script],capture_output=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr.decode())


if __name__ == '__main__':
    unittest.main()
