"""Linux synthetic transport lifecycle tests; no manager/process/private input reads."""
from contextlib import ExitStack
import importlib.util
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import stat
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('transport', Path(__file__).with_name('transport.py'))
transport = importlib.util.module_from_spec(spec); spec.loader.exec_module(transport)


@unittest.skipUnless(os.name == 'posix' and os.geteuid() == 0, 'Linux root metadata fixture')
class TransportLifecycle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.root.chmod(0o700)
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        for name, path in {'MOUNT': self.root, 'POLICY': self.root/'private/tunnel.json',
                           'TOKEN': self.root/'private/tunnel.token', 'CONFIG': self.root/'private/tunnel.yml',
                           'BINARY': self.root/'cloudflared', 'FRAGMENT': self.root/'tunnel.service',
                           'PROC': self.root/'proc', 'CGROUP': self.root/'cgroup'}.items():
            self.stack.enter_context(patch.object(transport, name, path))
        # Test only our fresh private tree. Model protected ancestors so /tmp's
        # shared mode is not confused with the deployment's protected /var path.
        original_stat = Path.stat
        def ancestor_stat(path, *args, **kwargs):
            if path in self.root.parents:
                return SimpleNamespace(st_uid=0, st_mode=stat.S_IFDIR | 0o755)
            return original_stat(path, *args, **kwargs)
        self.stack.enter_context(patch.object(Path, 'stat', ancestor_stat))
        transport.POLICY.parent.mkdir(mode=0o700)
        for path, data in ((transport.TOKEN, b'synthetic-tunnel-token'), (transport.CONFIG, b'synthetic: true\n'),
                           (transport.BINARY, b'synthetic executable'), (transport.FRAGMENT, b'synthetic unit')):
            path.write_bytes(data); path.chmod(0o600)
        self.context = {'profile': 'pc-private', 'sourceId': 'synthetic-source'}
        self.value = {'version': 1, 'sourceId': self.context['sourceId'], 'enabled': True,
                      **{name+'Sha256': transport.sha(path) for name, path in
                         (('token', transport.TOKEN), ('config', transport.CONFIG),
                          ('binary', transport.BINARY), ('unit', transport.FRAGMENT))}}
        self.write_policy(self.value)
        self.props = dict(LoadState='loaded', Type='exec', ActiveState='active', SubState='running', FreezerState='running',
            MainPID='2024', ControlPID='0', ControlGroup='/system.slice/'+transport.UNIT, InvocationID='a'*32,
            ExecMainStartTimestampMonotonic='100000', FragmentPath=str(transport.FRAGMENT), DropInPaths='', User='65532', Group='65532',
            NoNewPrivileges='yes', CapabilityBoundingSet='', AmbientCapabilities='', EnvironmentFiles='',
            Environment='HOME=/nonexistent PATH=/usr/bin:/bin', LoadCredential='token:'+str(transport.TOKEN)+' config:'+str(transport.CONFIG),
            ProtectSystem='strict', ProtectHome='yes', PrivateTmp='yes', PrivateDevices='yes',
            InaccessiblePaths=str(transport.MOUNT), StandardOutput='null', StandardError='null', KillMode='control-group', Restart='on-failure',
            ExecStart='{ path='+str(transport.BINARY)+' ; argv[]='+' '.join(transport.argv())+' ; ignore_errors=no ; }',
            ExecStartPre='{ argv[]=/usr/bin/findmnt --noheadings --mountpoint /var/lib/tuat-local --source /dev/mapper/tuat-local-data --types ext4 ; } '
                         '{ argv[]=/usr/bin/python3 -I /opt/tuat-local-runtime/transport.py --preflight ; }')
        self.events = []
        self.listener = 'LISTEN 0 4096 127.0.0.1:18305 0.0.0.0:* users:(("cloudflared",pid=2024,fd=3))\n'
        self.commands = SimpleNamespace(run=self.command)
        self.process = transport.PROC/'2024'; self.process.mkdir(parents=True)
        (self.process/'stat').write_text('2024 (cloudflared worker) '+' '.join(['S']+['0']*18+['12345']))
        (self.process/'cgroup').write_text('0::/system.slice/'+transport.UNIT+'\n')
        (self.process/'cmdline').write_bytes(b'\0'.join(arg.encode() for arg in transport.argv())+b'\0')
        (self.process/'status').write_text('Uid:\t65532 65532 65532 65532\nGid:\t65532 65532 65532 65532\nGroups:\nNoNewPrivs:\t1\n'+
            ''.join(key+':\t0000000000000000\n' for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb')))
        (self.process/'exe').symlink_to(transport.BINARY)
        (self.process/'environ').write_bytes(b'CREDENTIALS_DIRECTORY='+transport.CREDENTIALS.encode()+b'\0HOME=/nonexistent\0')
        credentials = self.process/'root'/transport.CREDENTIALS.lstrip('/'); credentials.mkdir(parents=True)
        for name, source in (('token', transport.TOKEN), ('config', transport.CONFIG)):
            p = credentials/name; p.write_bytes(source.read_bytes()); os.chown(p, 65532, 65532); p.chmod(0o400)
        self.group = transport.CGROUP/'system.slice'/transport.UNIT; self.group.mkdir(parents=True)
        (self.group/'cgroup.procs').write_text('2024\n')

    def write_policy(self, value):
        transport.POLICY.write_text(json.dumps(value)); transport.POLICY.chmod(0o600)

    def command(self, args):
        self.events.append(args)
        if args[:2] == ['systemctl', 'show']:
            return '\n'.join(key+'='+value for key, value in self.props.items()).encode()
        if args == ['ss', '-H', '-ltnp', 'sport = :18305']:
            return self.listener.encode()
        raise AssertionError('Unexpected synthetic command')

    def observe(self):
        return transport.observe(self.context, self.commands, True)

    def inactive(self):
        self.props.update(ActiveState='inactive', SubState='dead', MainPID='0', ControlGroup='', InvocationID='', ExecMainStartTimestampMonotonic='0')

    def test_active_exact_identity_and_initial_inactive_are_accepted_without_mutation(self):
        before = self.observe()
        self.assertEqual(before['processBirth'], '12345')
        self.assertEqual(before, self.observe())
        self.assertTrue(all(row[:2] in (['systemctl','show'], ['ss','-H']) for row in self.events))
        self.inactive(); self.events.clear()
        with patch.object(transport, 'process_identity', side_effect=AssertionError('Inactive process read')):
            self.assertIsNone(self.observe()['processBirth'])
        self.assertTrue(all(row[:2] == ['systemctl','show'] for row in self.events))

    def test_absent_and_disabled_preserve_compatibility_and_never_admit_a_live_transport(self):
        for value in (None, {'version':1, 'sourceId':'synthetic-source', 'enabled':False}):
            with self.subTest(value=value):
                if value is None: transport.POLICY.unlink()
                else: self.write_policy(value)
                self.assertEqual(transport.observe(self.context, self.commands, False), {'policy':value, 'unit':None})
                self.props.update(ActiveState='active', SubState='running', MainPID='2024', ControlGroup='/system.slice/'+transport.UNIT,
                                  InvocationID='a'*32, ExecMainStartTimestampMonotonic='100000')
                with self.assertRaisesRegex(transport.Hold, 'active-state'): self.observe()
                self.inactive()
                self.props['Environment'] = 'SYNTHETIC_PRIVATE_VALUE=do-not-serialize'
                self.assertNotIn('do-not-serialize', json.dumps(self.observe()))
        with self.assertRaisesRegex(transport.Hold, 'profile'):
            transport.observe({'profile':'surface'}, self.commands, True)

    def test_policy_identity_shape_and_all_four_pins_are_required(self):
        for key, value in (('sourceId','wrong-source'), ('enabled',1), ('version',2), ('unexpected',True)):
            self.write_policy({**self.value, key:value})
            with self.assertRaises(transport.Hold): self.observe()
        for key in ('unitSha256','binarySha256','configSha256','tokenSha256'):
            self.write_policy({**self.value, key:'0'*64})
            with self.assertRaisesRegex(transport.Hold, 'file-pin'): self.observe()
        self.write_policy(self.value)
        with self.assertRaisesRegex(transport.Hold, 'unit-inventory'):
            transport.observe(self.context, self.commands, False)

    def test_root_private_permissions_symlink_and_moved_device_are_refused(self):
        transport.TOKEN.chmod(0o640)
        with self.assertRaisesRegex(transport.Hold,'file'): self.observe()
        transport.TOKEN.chmod(0o600)
        saved = transport.TOKEN.with_suffix('.saved'); transport.TOKEN.rename(saved); transport.TOKEN.symlink_to(saved)
        with self.assertRaisesRegex(transport.Hold,'path'): self.observe()
        transport.TOKEN.unlink(); saved.rename(transport.TOKEN)
        transport.POLICY.parent.chmod(0o750)
        with self.assertRaisesRegex(transport.Hold,'private-directory'): self.observe()
        transport.POLICY.parent.chmod(0o700)
        original = Path.stat
        def wrong_device(path, *args, **kwargs):
            if path == transport.TOKEN:
                s = original(path,*args,**kwargs)
                return SimpleNamespace(st_mode=s.st_mode, st_uid=s.st_uid, st_nlink=s.st_nlink, st_dev=-1)
            return original(path,*args,**kwargs)
        with patch.object(Path,'stat',wrong_device):
            with self.assertRaisesRegex(transport.Hold,'encrypted-device'): self.observe()

    def test_unit_replacement_dropin_argv_log_or_privilege_change_is_refused(self):
        baseline = self.props.copy()
        for key, value in (('DropInPaths','/unsafe.conf'), ('User','root'), ('NoNewPrivileges','no'),
                           ('CapabilityBoundingSet','cap_net_raw'), ('Environment','TUNNEL_TOKEN=synthetic-secret'),
                           ('ExecStart',baseline['ExecStart'].replace('--token-file','--token')),
                           ('ExecStartPre',''), ('LoadCredential',''), ('StandardError','journal'),
                           ('ProtectSystem','no'), ('PrivateDevices','no'), ('ControlPID','2'), ('FreezerState','frozen')):
            with self.subTest(key=key):
                self.props = {**baseline,key:value}
                with self.assertRaises(transport.Hold) as error: self.observe()
                self.assertNotIn('synthetic-secret', str(error.exception))
        self.props = baseline

    def test_process_identity_privilege_environment_and_live_credentials_are_verified(self):
        for name, bad in (('cmdline',b'/bin/sh\0'), ('cgroup',b'0::/wrong\n'),
                          ('status',(self.process/'status').read_bytes().replace(b'NoNewPrivs:\t1',b'NoNewPrivs:\t0')),
                          ('environ',b'TUNNEL_TOKEN=synthetic-secret\0')):
            path = self.process/name; before = path.read_bytes(); path.write_bytes(bad)
            with self.assertRaises(transport.Hold) as error: self.observe()
            self.assertNotIn('synthetic-secret', str(error.exception))
            path.write_bytes(before)
        (self.group/'cgroup.procs').write_text('2024\n2025\n')
        with self.assertRaisesRegex(transport.Hold,'cgroup-processes'): self.observe()
        (self.group/'cgroup.procs').write_text('2024\n')
        credential = self.process/'root'/transport.CREDENTIALS.lstrip('/')/'token'
        credential.chmod(0o600); credential.write_bytes(b'other-synthetic-token'); credential.chmod(0o400)
        with self.assertRaisesRegex(transport.Hold,'live-credential-pin'): self.observe()

    def test_pid_reuse_and_invocation_change_during_observation_are_refused(self):
        original = Path.read_text; calls = [0]
        def replacement(path,*args,**kwargs):
            text = original(path,*args,**kwargs)
            if path == self.process/'stat':
                calls[0] += 1
                if calls[0] > 1: return text.replace('12345','12346')
            return text
        with patch.object(Path,'read_text',replacement):
            with self.assertRaisesRegex(transport.Hold,'process-replaced'): self.observe()
        original_run = self.commands.run; shows = [0]
        def restarted(args):
            if args[:2] == ['systemctl','show']:
                shows[0] += 1
                if shows[0] > 1: self.props['InvocationID'] = 'b'*32
            return original_run(args)
        self.commands.run = restarted
        with self.assertRaisesRegex(transport.Hold,'unit-replaced'): self.observe()

    def test_metrics_requires_exact_loopback_listener_owned_by_the_verified_pid(self):
        baseline = self.listener
        for bad in ('', baseline.replace('127.0.0.1','0.0.0.0'), baseline.replace('pid=2024','pid=2025'),
                    baseline+baseline, baseline.replace('127.0.0.1:18305','[::]:18305')):
            self.listener = bad
            with self.assertRaisesRegex(transport.Hold,'metrics-boundary'): self.observe()

    def test_manager_errors_and_duplicate_properties_never_become_absence(self):
        for result in ('LoadState=not-found', 'LoadState=loaded\nLoadState=loaded'):
            self.commands.run = lambda _args: result
            with self.assertRaises(transport.Hold): self.observe()
        def unavailable(_args): raise OSError('synthetic private command output')
        self.commands.run = unavailable
        with self.assertRaisesRegex(transport.Hold,'transport-observation-failed') as error: self.observe()
        self.assertNotIn('private command output',str(error.exception))

    def test_root_preflight_is_quiet_and_requires_the_matching_enabled_policy(self):
        runtime = self.root/'runtime.json'; runtime.write_text(json.dumps(self.context)); runtime.chmod(0o600)
        original = transport.immutable
        def protected(path,*args):
            return original(runtime if str(path) == '/etc/tuat-local/runtime.json' else path,*args)
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(transport,'immutable',side_effect=protected), patch.object(transport.sys,'argv',['transport.py','--preflight']), \
             patch.object(transport.sys,'stdout',output), patch.object(transport.sys,'stderr',errors):
            self.assertEqual(transport.main(),0)
            self.write_policy({'version':1, 'sourceId':'synthetic-source', 'enabled':False})
            self.assertEqual(transport.main(),1)
            self.write_policy({**self.value,'sourceId':'other-source'})
            self.assertEqual(transport.main(),1)
        self.assertEqual(output.getvalue()+errors.getvalue(),'')


if __name__ == '__main__':
    unittest.main()
