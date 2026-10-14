"""Behaviour/fault tests; no service or database commands execute."""
import importlib.util
import hashlib
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup', Path(__file__).with_name('backup.py'))
backup = importlib.util.module_from_spec(spec); spec.loader.exec_module(backup)


class FixtureCommands:
    def __init__(self, config):
        self.config, self.events, self.states = config, [], {}
        self.fail_pause, self.fail_resume, self.extra = None, None, None
        for role, name in config['containers'].items():
            self.states[name] = {'Id': name, 'RestartCount': 0,
                'State': {'Running': True, 'Paused': role == 'auth', 'Restarting': False,
                          'Dead': False, 'Status': 'running', 'StartedAt': 'fixed'},
                'Config': {'Image': backup.DB_IMAGE if role == 'db' else 'node:24.19.0-bookworm-slim',
                           'Labels': {backup.SOURCE_LABEL: config['sourceId'], backup.ROLE_LABEL: role}},
                'HostConfig': {'Privileged': False, 'NetworkMode': 'none'}, 'Mounts': []}

    def inspect(self, name):
        return self.states[name]

    def docker(self, *args, **_kwargs):
        assert args == ('ps', '-aq')
        return ' '.join(self.states).encode()

    def transition(self, kind, name, freeze):
        assert kind == 'container'
        self.events.append((name, freeze))
        self.states[name]['State']['Paused'] = freeze
        if (freeze and self.fail_pause == name) or (not freeze and self.fail_resume == name):
            raise backup.BackupFailure('transition timeout after it happened')

    def verify_jobs_lock(self,config,jobs_info):
        backup.LocalCommands.verify_jobs_lock(self,config,jobs_info)

    def run(self, args, **_kwargs):
        assert all(not info['State']['Paused'] for name, info in self.states.items()
                   if name != self.config['containers']['auth'])
        self.events.append(('verification', args[2]))
        if args[2] == 'encrypt':
            Path(args[4]).write_bytes(b'fixture encrypted archive')
        else:
            Path(args[4]).write_bytes(Path(args[3]).read_bytes())
        return b''


class HostFixtureCommands(FixtureCommands):
    """Exercise the actual surface-systemd inventory/freeze path with fixed observations."""
    def __init__(self, config):
        super().__init__(config)
        self.units = {}
        for index, name in enumerate(backup.UNITS):
            active = index < 2
            self.units[name] = {'LoadState': 'loaded', 'ActiveState': 'active' if active else 'inactive',
                'SubState': 'running' if active else 'dead', 'FreezerState': 'running',
                'MainPID': str(101 + index) if active else '0', 'ControlPID': '0',
                'ControlGroup': '/system.slice/' + name if active else '',
                'InvocationID': str(index + 1).zfill(32) if active else '',
                'ExecMainStartTimestampMonotonic': '100000000' if active else '0'}

    def unit(self, name):
        return self.units[name].copy()

    def run(self, args, **kwargs):
        if args == ['systemctl', 'list-units', '--all', '--plain', '--no-legend', 'tuat-*.service']:
            return '\n'.join(' '.join([name, value['LoadState'], value['ActiveState'], value['SubState'], 'fixture'])
                for name, value in self.units.items() if value['LoadState'] != 'not-found').encode()
        return super().run(args, **kwargs)

    def transition(self, kind, name, freeze):
        if kind == 'unit':
            self.events.append((name, freeze))
            self.units[name]['FreezerState'] = 'frozen' if freeze else 'running'
            if (freeze and self.fail_pause == name) or (not freeze and self.fail_resume == name):
                raise backup.BackupFailure('transition timeout after it happened')
        else:
            super().transition(kind, name, freeze)


class BackupBehaviour(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name); self.root.chmod(0o700)
        self.config = {'version': 1, 'sourceId': 'unit-synthetic', 'writerMode': 'docker-fixture',
            'containers': {role: 'fixture-' + role for role in ('db', 'app', 'auth', 'rest', 'jobs')},
            'database': 'fixture', 'dbImage': backup.DB_IMAGE, 'mirrorDisabled': True}
        for field in ('imageRoot', 'jobsStateRoot', 'backupRoot', 'stageRoot'):
            path = self.root / field; path.mkdir(mode=0o700); self.config[field] = str(path)
        for field in ('runtimeKey', 'recoveryKeyCopy'):
            path = self.root / field; path.write_bytes(b'k' * 32); path.chmod(0o600); self.config[field] = str(path)
        self.config['receiptFile'] = str(Path(self.config['backupRoot']) / 'receipt.json')
        self.commands = FixtureCommands(self.config)

    def tearDown(self):
        self.temp.cleanup()

    def window(self):
        return backup.CaptureWindow(self.config, self.commands, Path(self.config['backupRoot']) / 'capture-state.json')

    def host(self):
        self.config['writerMode'] = 'surface-systemd'
        self.config['containers'] = {role: self.config['containers'][role] for role in ('db', 'auth', 'rest')}
        self.commands = HostFixtureCommands(self.config)

    def test_host_preserves_exact_inactive_trial_units_and_original_freeze_order(self):
        self.host()
        stopped = self.commands.units[backup.UNITS[2]]
        for name in backup.PRESERVED_TRIAL_UNITS:
            self.commands.units[name] = stopped.copy()
        before = {name: self.commands.unit(name) for name in backup.PRESERVED_TRIAL_UNITS}
        window = self.window(); window.enter(); window.verify_frozen(); window.restore()
        self.assertEqual(self.commands.events, [(backup.UNITS[0], True), (backup.UNITS[1], True),
            ('fixture-rest', True), ('fixture-rest', False), (backup.UNITS[1], False), (backup.UNITS[0], False)])
        self.assertTrue(self.commands.states['fixture-auth']['State']['Paused'])
        self.assertEqual(before, {name: self.commands.unit(name) for name in backup.PRESERVED_TRIAL_UNITS})

    def test_host_missing_mirror_requires_explicit_not_found_and_no_process(self):
        self.host()
        self.commands.units[backup.UNITS[2]]['LoadState'] = 'not-found'
        window = self.window(); window.enter(); window.verify_frozen(); window.restore()
        self.assertNotIn((backup.UNITS[2], True), self.commands.events)
        for key, value in (('LoadState', 'error'), ('LoadState', 'masked'), ('ActiveState', 'active'),
                           ('ActiveState', 'failed'), ('ActiveState', 'activating'), ('ActiveState', 'unknown'),
                           ('SubState', 'failed'), ('FreezerState', 'frozen'), ('MainPID', '99'),
                           ('ControlPID', '98'), ('ControlGroup', '/system.slice/unproven')):
            with self.subTest(key=key, value=value):
                baseline = self.commands.units[backup.UNITS[2]].copy()
                self.commands.units[backup.UNITS[2]][key] = value
                self.commands.events.clear()
                with self.assertRaises(backup.BackupFailure): self.window().enter()
                self.assertEqual(self.commands.events, [])
                self.commands.units[backup.UNITS[2]] = baseline

    def test_host_trial_unknown_active_failed_pid_and_cgroup_fail_before_freeze(self):
        self.host()
        name = backup.PRESERVED_TRIAL_UNITS[0]
        baseline = self.commands.units[backup.UNITS[2]].copy()
        for key, value in (('LoadState', 'masked'), ('ActiveState', 'active'), ('ActiveState', 'failed'),
                           ('ActiveState', 'activating'), ('ActiveState', 'unknown'), ('SubState', 'running'),
                           ('MainPID', '99'), ('ControlPID', '98'), ('ControlGroup', '/system.slice/unproven')):
            with self.subTest(key=key, value=value):
                self.commands.units[name] = {**baseline, key: value}
                with self.assertRaises(backup.BackupFailure): self.window().enter()
                self.assertEqual(self.commands.events, [])
        del self.commands.units[name]
        self.commands.units['tuat-unreviewed.service'] = baseline
        with self.assertRaisesRegex(backup.BackupFailure, 'Unaccounted'): self.window().enter()
        self.assertEqual(self.commands.events, [])

    def test_host_preserved_unit_activation_and_mirror_installation_during_capture_refused(self):
        self.host()
        name = backup.PRESERVED_TRIAL_UNITS[0]
        self.commands.units[name] = self.commands.units[backup.UNITS[2]].copy()
        self.commands.units[backup.UNITS[2]]['LoadState'] = 'not-found'
        window = self.window(); window.enter()
        self.commands.units[name]['MainPID'] = '99'
        with self.assertRaisesRegex(backup.BackupFailure, 'inactive'): window.verify_frozen()
        self.commands.units[name]['MainPID'] = '0'
        self.commands.units[backup.UNITS[2]]['LoadState'] = 'loaded'
        with self.assertRaisesRegex(backup.BackupFailure, 'inventory changed'): window.verify_frozen()
        with self.assertRaisesRegex(backup.BackupFailure, 'not restored'): window.restore()
        self.assertEqual(json.loads(window.checkpoint.read_text())['phase'], 'resume-unverified')
        self.assertFalse(self.commands.states['fixture-rest']['State']['Paused'])

    def test_host_inventory_change_during_resume_holds_without_operating_old_units(self):
        self.host()
        window = self.window(); window.enter()
        name = backup.PRESERVED_TRIAL_UNITS[-1]
        original = self.commands.transition
        def changed_transition(kind, unit_name, freeze):
            original(kind, unit_name, freeze)
            if not freeze:
                self.commands.units[name] = self.commands.units[backup.UNITS[0]].copy()
        self.commands.transition = changed_transition
        with self.assertRaisesRegex(backup.BackupFailure, 'not restored'): window.restore()
        self.assertEqual(json.loads(window.checkpoint.read_text())['phase'], 'resume-unverified')
        self.assertNotIn((name, True), self.commands.events)
        self.assertNotIn((name, False), self.commands.events)
        self.assertEqual(self.commands.units[backup.UNITS[0]]['FreezerState'], 'running')
        self.assertEqual(self.commands.units[backup.UNITS[1]]['FreezerState'], 'running')
        self.assertFalse(self.commands.states['fixture-rest']['State']['Paused'])

    def test_host_new_trial_or_unknown_unit_during_capture_refused(self):
        self.host()
        window = self.window(); window.enter()
        active = self.commands.units[backup.UNITS[0]].copy()
        name = backup.PRESERVED_TRIAL_UNITS[0]
        self.commands.units[name] = active
        with self.assertRaisesRegex(backup.BackupFailure, 'inventory changed'): window.verify_frozen()
        del self.commands.units[name]
        self.commands.units['tuat-unreviewed.service'] = active
        with self.assertRaisesRegex(backup.BackupFailure, 'Unaccounted'): window.verify_frozen()
        del self.commands.units['tuat-unreviewed.service']
        window.verify_frozen(); window.restore()

    def test_host_failed_inactive_current_writer_and_pid_change_do_not_pass_capture(self):
        self.host()
        self.commands.units[backup.UNITS[0]].update(ActiveState='inactive', SubState='dead', MainPID='101')
        with self.assertRaisesRegex(backup.BackupFailure, 'inactive'): self.window().enter()
        self.assertEqual(self.commands.events, [])
        self.commands.units[backup.UNITS[0]].update(ActiveState='active', SubState='running')
        window = self.window(); window.enter()
        self.commands.units[backup.UNITS[1]]['MainPID'] = '999'
        with self.assertRaisesRegex(backup.BackupFailure, 'identity changed'): window.verify_frozen()
        with self.assertRaisesRegex(backup.BackupFailure, 'not restored'): window.restore()
        self.assertEqual(json.loads(window.checkpoint.read_text())['phase'], 'resume-unverified')

    def test_systemctl_missing_unit_exit_only_accepts_exact_observation(self):
        props = b'LoadState=not-found\nActiveState=inactive\nSubState=dead\nFreezerState=running\nControlGroup=\nMainPID=0\nControlPID=0\n'
        actual_popen = subprocess.Popen
        def observe(code, data):
            def popen(_args, **kwargs):
                script = 'import sys;sys.stdout.buffer.write(' + repr(data) + ');sys.stderr.write("FAKE_CANARY");sys.exit(' + str(code) + ')'
                return actual_popen([sys.executable, '-I', '-c', script], **kwargs)
            return patch.object(backup.subprocess, 'Popen', popen)
        for code in (0, 1, 4):
            with self.subTest(code=code), observe(code, props):
                info = backup.LocalCommands().unit(backup.UNITS[2])
                self.assertEqual(backup.inactive_unit_state(info, missing_allowed=True)['LoadState'], 'not-found')
        for code, output in ((2, props), (1, props.replace(b'not-found', b'loaded'))):
            with self.subTest(code=code), observe(code, output):
                with self.assertRaises(backup.BackupFailure): backup.LocalCommands().unit(backup.UNITS[2])

    def test_originally_paused_auth_remains_paused_and_order_is_reversed(self):
        window = self.window(); window.enter(); window.restore()
        self.assertEqual(self.commands.events, [
            ('fixture-jobs', True), ('fixture-app', True), ('fixture-rest', True),
            ('fixture-rest', False), ('fixture-app', False), ('fixture-jobs', False)])
        self.assertTrue(self.commands.states['fixture-auth']['State']['Paused'])

    def test_pause_timeout_after_success_is_recovered_from_durable_intent(self):
        window = self.window(); self.commands.fail_pause = 'fixture-app'
        with self.assertRaises(backup.BackupFailure): window.enter()
        saved = json.loads(window.checkpoint.read_text())
        self.assertIn({'kind': 'container', 'name': 'fixture-app'}, saved['changed'])
        window.restore()
        self.assertFalse(self.commands.states['fixture-app']['State']['Paused'])
        self.assertFalse(self.commands.states['fixture-jobs']['State']['Paused'])

    def test_unknown_container_and_restarted_identity_fail_closed(self):
        self.commands.states['foreign'] = {**self.commands.states['fixture-app'], 'Id': 'foreign'}
        with self.assertRaisesRegex(backup.BackupFailure, 'Unaccounted'): self.window().enter()
        self.assertEqual(self.commands.events, [])
        del self.commands.states['foreign']
        window = self.window(); window.enter()
        self.commands.states['fixture-app']['RestartCount'] += 1
        with self.assertRaisesRegex(backup.BackupFailure, 'not restored'): window.restore()
        self.assertEqual(json.loads(window.checkpoint.read_text())['phase'], 'resume-unverified')

    def journal(self, status):
        path = Path(self.config['jobsStateRoot']) / 'journal.json'
        data = json.dumps({'version': 1, 'activateAt': 1735689600000,
            'jobs': {'sheets': {'status': status, 'slot': 1735776000000,
                               'startedAt': 1735776001000, 'finishedAt': 1735776002000}},
            'sheetWritesBlocked': True}).encode()
        path.write_bytes(data); path.chmod(0o600)
        return path, data

    def scheduler_state(self, status='failed'):
        journal = {'version': 1, 'activateAt': 1735689600000, 'jobs': {
            'sheets': {'slot': 1735776000000, 'status': status, 'startedAt': 1735776001000,
                'finishedAt': 1735776002000, 'httpStatus': 500, 'sheetWritesUncertain': True}},
            'sheetWritesBlocked': True,
            'sheetFailures': [{'slot': 1735689600000, 'status': 'uncertain', 'evidence': 'synthetic old fault'}],
            'sheetRecoveryHistory': [{'confirmedAt': '2025-01-02T00:00:03.000Z', 'evidence': 'synthetic retained review'}]}
        status_value = {'checkedAt': '2025-01-02T00:00:05.000Z', 'jobs': copy.deepcopy(journal['jobs'])}
        directory = Path(self.config['jobsStateRoot'])
        for name, value in (('journal.json', journal), ('status.json', status_value)):
            path = directory / name
            path.write_bytes(json.dumps(value, separators=(',', ':')).encode()); path.chmod(0o600)
        return journal, status_value

    def test_status_preserves_historical_failure_uncertain_partial_and_recovery_verbatim(self):
        for outcome in ('success', 'partial', 'failed', 'uncertain'):
            with self.subTest(outcome=outcome):
                self.scheduler_state(outcome)
                root = Path(self.config['jobsStateRoot'])
                before = {name: (root/name).read_bytes() for name in ('journal.json', 'status.json')}
                rows = backup.journal_snapshot(root)
                self.assertEqual({row['name']: row['bytes'] for row in rows}, before)
                self.assertEqual(before, {name: (root/name).read_bytes() for name in before})

    def test_status_running_unknown_malformed_or_contradictory_refuses_without_repair(self):
        journal, baseline = self.scheduler_state()
        root = Path(self.config['jobsStateRoot']); path = root/'status.json'
        variants = []
        for change in ('running', 'unknown', 'bad_slot', 'bad_finished', 'bad_http', 'bad_hold',
                       'later_slot', 'other_terminal', 'unknown_job', 'invalid_time', 'future_time', 'extra_fault'):
            value = copy.deepcopy(baseline); job = value['jobs']['sheets']
            if change in ('running', 'unknown'): job['status'] = change
            elif change == 'bad_slot': job['slot'] = True
            elif change == 'bad_finished': job['finishedAt'] = job['startedAt']-1
            elif change == 'bad_http': job['httpStatus'] = True
            elif change == 'bad_hold': job['sheetWritesUncertain'] = 'unknown'
            elif change == 'later_slot': job['slot'] += 86400000
            elif change == 'other_terminal': job['status'] = 'success'
            elif change == 'unknown_job': value['jobs']['unknown-writer'] = value['jobs'].pop('sheets')
            elif change == 'invalid_time': value['checkedAt'] = '2025-99-02T00:00:05.000Z'
            elif change == 'future_time': value['checkedAt'] = '2099-01-02T00:00:05.000Z'
            elif change == 'extra_fault': value['fault'] = 'synthetic current unrecognized fault'
            variants.append((change, json.dumps(value).encode()))
        variants += [('oversize', b'x'*(backup.MAX_JOB_STATE+1)), ('malformed', b'not-json')]
        for change, value in variants:
            with self.subTest(change=change):
                path.write_bytes(value)
                with self.assertRaises((backup.BackupFailure, ValueError)): backup.journal_snapshot(root)
                self.assertEqual(path.read_bytes(), value)
                self.assertEqual(self.commands.events, [])
        self.scheduler_state()
        (root/'journal.json').unlink()
        with self.assertRaisesRegex(backup.BackupFailure, 'format'): backup.journal_snapshot(root)

    def test_status_may_lag_terminal_journal_but_current_dispatch_and_temp_file_hold(self):
        journal, status = self.scheduler_state()
        root = Path(self.config['jobsStateRoot']); path = root/'journal.json'
        journal['jobs']['sheets']['slot'] += 86400000
        journal['jobs']['sheets']['sheetWritesUncertain'] = False
        path.write_bytes(json.dumps(journal).encode())
        self.assertEqual(len(backup.journal_snapshot(root)), 2)
        journal['jobs']['sheets']['status'] = 'running'
        path.write_bytes(json.dumps(journal).encode())
        with self.assertRaisesRegex(backup.BackupFailure, 'dispatch'): backup.journal_snapshot(root)
        self.scheduler_state()
        (root/'status.json.tmp').write_bytes(b'current interrupted rename')
        with self.assertRaisesRegex(backup.BackupFailure, 'interrupted'): backup.journal_snapshot(root)

    def test_journal_numeric_contract_always_checked_without_status(self):
        journal, _status = self.scheduler_state()
        root = Path(self.config['jobsStateRoot']); path = root/'journal.json'
        (root/'status.json').unlink()
        for change in ('activation_string', 'activation_boolean', 'slot_string', 'slot_nan', 'unknown_job'):
            value = copy.deepcopy(journal)
            if change == 'activation_string': value['activateAt'] = '2025-01-01T00:00:00Z'
            elif change == 'activation_boolean': value['activateAt'] = True
            elif change == 'slot_string': value['jobs']['sheets']['slot'] = 'historical-fixture'
            elif change == 'slot_nan': value['jobs']['sheets']['slot'] = float('nan')
            else: value['jobs']['unknown-writer'] = value['jobs'].pop('sheets')
            raw = json.dumps(value).encode(); path.write_bytes(raw)
            with self.subTest(change=change), self.assertRaises(backup.BackupFailure): backup.journal_snapshot(root)
            self.assertEqual(path.read_bytes(), raw)

    def test_interrupted_current_uncertain_with_or_without_status_holds_prior_receipt(self):
        root = Path(self.config['jobsStateRoot'])
        receipt = Path(self.config['receiptFile']); original = b'{"verifiedAt":"old-retained-proof"}'
        receipt.write_bytes(original); receipt.chmod(0o600)
        for has_status in (False, True):
            with self.subTest(has_status=has_status):
                journal, status = self.scheduler_state('uncertain')
                del journal['jobs']['sheets']['finishedAt']
                (root/'journal.json').write_bytes(json.dumps(journal).encode())
                if has_status:
                    del status['jobs']['sheets']['finishedAt']
                    (root/'status.json').write_bytes(json.dumps(status).encode())
                else:
                    (root/'status.json').unlink()
                before = {name: (root/name).read_bytes() for name in ('journal.json','status.json') if (root/name).exists()}
                def captured(*_args):
                    backup.journal_snapshot(root)
                    raise AssertionError('Interrupted current request passed validation')
                with patch.object(backup, 'capture_bundle', captured):
                    with self.assertRaisesRegex(backup.BackupFailure, 'terminal dispatch evidence'):
                        backup.produce(self.config, self.commands)
                self.assertEqual(receipt.read_bytes(), original)
                self.assertEqual(before, {name: (root/name).read_bytes() for name in before})
                self.assertEqual(json.loads((receipt.parent/'capture-state.json').read_bytes())['phase'], 'resumed')
        self.assertFalse(any(event[0] == 'verification' for event in self.commands.events))

    def test_confirmed_retired_image_is_preserved_but_untracked_orphan_refuses_capture(self):
        self.journal('failed')
        root = Path(self.config['imageRoot'])
        directory = root/'avatars'/'member-1'
        directory.mkdir(parents=True, mode=0o700)
        (root/'avatars').chmod(0o700)
        image = directory/'retired.webp'
        image.write_bytes(b'synthetic retired WebP bytes'); image.chmod(0o600)
        class CaptureCommands:
            def __init__(self, recorded): self.recorded = recorded
            def sql(self, _config, statement):
                return b'avatars/member-1/retired.webp\n' if self.recorded and 'confirmed_image_retirements' in statement else b''
            def docker(self, *args, output=None):
                output.write(b'PGDMP synthetic dump' if args[2] == 'pg_dump' else b'-- synthetic role SQL')
        with patch.object(backup, 'assert_database_quiet'), patch.object(backup, 'image_references', return_value=[]), \
             patch.object(backup, 'database_fingerprint', return_value={'synthetic': 'stable'}):
            bundle, manifest = backup.capture_bundle(self.config, CaptureCommands(True), Path(self.config['stageRoot']))
            restored = self.root/'retired-restored'; restored.mkdir(mode=0o700)
            backup.verified_extract(bundle, restored, self.config['sourceId'])
            self.assertEqual((restored/'images'/'avatars'/'member-1'/'retired.webp').read_bytes(), image.read_bytes())
            self.assertEqual(len(manifest['images']), 1)
            unknown = self.root/'unknown-capture'; unknown.mkdir(mode=0o700)
            with self.assertRaisesRegex(backup.BackupFailure, 'Unreferenced image'):
                backup.capture_bundle(self.config, CaptureCommands(False), unknown)

    def retained_images_fixture(self):
        """New synthetic bytes only; root runs this temp fixture, never real R2 files."""
        config = {**self.config, 'profile':'pc-private', 'writerMode':'surface-systemd', 'sourceOwnerUid':65530,
            'containers':{role:'tuat-local-'+role for role in ('db','auth','rest')},
            'jobsReceiptFile':str(self.root/'synthetic-reader/verified.json')}
        config['periodic'] = {name:bounds[0] for name,bounds in backup.periodic.LIMITS.items()}
        config['periodic'].update(enabled=True, controlSeal=str(self.root/'synthetic-seal.json'),
            configPath=str(self.root/'synthetic-backup.json'), allowUntil='2099-01-01T00:00:00+00:00')
        config['periodic']['maxTotalArchiveBytes'] += 36
        image_root = Path(config['imageRoot']); directory = image_root/'avatars/member-1'
        directory.mkdir(parents=True,mode=0o700)
        for path in (image_root,image_root/'avatars',directory): path.chmod(0o700); os.chown(path,65530,65530)
        images = {}
        for name in ('retained-1.webp','retained-2.webp','live.webp'):
            path = directory/name; data = ('synthetic preserved image '+name).encode()
            path.write_bytes(data); path.chmod(0o600); os.chown(path,65530,65530)
            images[path.relative_to(image_root).as_posix()] = (path,data)
        config['retainedUnreferencedImages'] = {key:{'sha256':backup.hashlib.sha256(data).hexdigest(),'bytes':len(data)}
            for key,(_path,data) in images.items() if not key.endswith('/live.webp')}
        return config,images

    def test_retained_image_baseline_is_strict_bounded_and_requires_sealed_pc_config(self):
        config,images = self.retained_images_fixture()
        backup.validate_config(config)
        baseline = config['retainedUnreferencedImages']; key = next(iter(baseline)); good = baseline[key]
        for value in (None,[],True,{'/outside.webp':good},{'avatars/member-1/../outside.webp':good},
            {key:{**good,'unexpected':True}},{key:{'bytes':good['bytes']}},{key:{**good,'sha256':'A'*64}},
            {key:{**good,'sha256':'a'*63}},{key:{**good,'bytes':True}},{key:{**good,'bytes':1.0}},
            {key:{**good,'bytes':0}},{key:{**good,'bytes':backup.MAX_IMAGE+1}}):
            with self.subTest(value=value), self.assertRaises(backup.BackupFailure):
                backup.retained_unreferenced_images({**config,'retainedUnreferencedImages':value})
        for changed in ({**config,'profile':'surface'}, {**config,'periodic':None}):
            with self.assertRaisesRegex(backup.BackupFailure,'sealed PC'): backup.retained_unreferenced_images(changed)
        with patch.object(backup,'MAX_ENTRIES',1):
            with self.assertRaisesRegex(backup.BackupFailure,'baseline'): backup.retained_unreferenced_images(config)
        with patch.object(backup,'MAX_BYTES',sum(row['bytes'] for row in baseline.values())-1):
            with self.assertRaisesRegex(backup.BackupFailure,'byte bound'): backup.retained_unreferenced_images(config)
        self.assertEqual(backup.retained_unreferenced_images({}),{})
        self.assertEqual(backup.retained_unreferenced_images({'retainedUnreferencedImages':{}}),{})

    def test_retained_baseline_bytes_are_in_full_archive_and_restored_inventory(self):
        config,images = self.retained_images_fixture()
        class CaptureCommands:
            def sql(self,_config,_statement): return b''
            def docker(self,*args,output=None): output.write(b'PGDMP synthetic dump' if args[2]=='pg_dump' else b'-- synthetic roles')
        # Only the already covered runtime/seal/DB observations are injected;
        # image scan, exact baseline, tar and authenticated-extract checks are real.
        # Exercise the real capacity policy with a synthetic admitted mount,
        # filesystem and memory observation; no live encrypted storage is read.
        with patch.object(backup.periodic,'pc_database'), patch.object(backup,'assert_database_quiet'), \
             patch.object(backup,'image_references',return_value=['avatars/member-1/live.webp']), \
             patch.object(backup,'database_fingerprint',return_value={'synthetic':'stable'}), \
             patch.object(backup,'pc_vault_key',return_value=b'c'*64+b'\n'), \
             patch.object(backup,'vault_fingerprint',return_value={'rows':2,'sha256':'d'*64}), \
             patch.object(backup.periodic,'bind_storage'), patch.object(backup.periodic.os,'statvfs',return_value=SimpleNamespace(f_bavail=1048576,f_frsize=4096,f_favail=10000)), \
             patch.object(Path,'read_text',autospec=True,side_effect=lambda path: 'MemAvailable: 65536 kB\n' if str(path)=='/proc/meminfo' else self.fail('Unexpected memory observation')):
            bundle,manifest = backup.capture_bundle(config,CaptureCommands(),Path(config['stageRoot']))
        restored = self.root/'restored-baseline'; restored.mkdir(mode=0o700)
        self.assertEqual(backup.verified_extract(bundle,restored,config['sourceId']),manifest)
        self.assertEqual(manifest['retainedUnreferencedImages'],config['retainedUnreferencedImages'])
        self.assertEqual(backup.image_inventory(restored/'images'),manifest['images'])
        self.assertEqual((restored/'vault-root.key').read_bytes(), b'c'*64+b'\n')
        self.assertEqual(manifest['files']['vault-root.key'], backup.file_hash(restored/'vault-root.key'))
        # A valid-looking replacement key must not be accepted as the authenticated original.
        tampered=self.root/'wrong-vault-key.tar'
        with tarfile.open(bundle,'r:') as incoming, tarfile.open(tampered,'w:') as outgoing:
            for item in incoming:
                content=incoming.extractfile(item).read()
                if item.name=='vault-root.key': content=b'd'*64+b'\n'
                item.size=len(content);outgoing.addfile(item,io.BytesIO(content))
        rejected=self.root/'wrong-vault-key-restored';rejected.mkdir(mode=0o700)
        with self.assertRaisesRegex(backup.BackupFailure,'Vault key hash/format'):
            backup.verified_extract(tampered,rejected,config['sourceId'])
        for key,(path,data) in images.items():
            self.assertEqual((restored/'images'/key).read_bytes(),data); self.assertEqual(path.read_bytes(),data)
        for directory in (restored,restored/'images',restored/'images/avatars',restored/'images/avatars/member-1'):
            self.assertEqual((directory.stat().st_uid,directory.stat().st_mode & 0o777),(0,0o700))
        # Insert pre-existing bad nested metadata after the extractor creates its
        # image root. Only these fresh temp targets are changed; never chmod a
        # successful restore to conceal an intermediate-directory bug.
        original_open = backup.tarfile.open
        for fault in ('symlink','owner','mode'):
            target = self.root/('bad-parent-'+fault); target.mkdir(mode=0o700)
            escaped = self.root/('escape-'+fault); escaped.mkdir(mode=0o700)
            marker = escaped/'untouched'; marker.write_bytes(b'outside restore'); marker.chmod(0o600)
            def injected_open(*args,**kwargs):
                parent = target/'images/avatars'
                if fault=='symlink': parent.symlink_to(escaped,target_is_directory=True)
                else:
                    parent.mkdir(mode=0o700)
                    if fault=='owner': os.chown(parent,65530,65530)
                    if fault=='mode': parent.chmod(0o500)
                return original_open(*args,**kwargs)
            with patch.object(backup.tarfile,'open',side_effect=injected_open), self.assertRaises(backup.BackupFailure):
                backup.verified_extract(bundle,target,config['sourceId'])
            self.assertEqual(marker.read_bytes(),b'outside restore')
            if fault=='owner': self.assertEqual((target/'images/avatars').stat().st_uid,65530)
            if fault=='mode': self.assertEqual((target/'images/avatars').stat().st_mode & 0o777,0o500)

    def test_retained_baseline_missing_changed_extra_or_default_holds_files_and_old_receipt(self):
        config,images = self.retained_images_fixture(); key = next(iter(config['retainedUnreferencedImages'])); path,data = images[key]
        extra = path.parent/'unapproved-new-upload.webp'
        receipt = Path(config['receiptFile']); receipt.write_bytes(b'old verified receipt'); receipt.chmod(0o600)
        class NoDump:
            def sql(self,_config,_statement): return b''
            def docker(self,*_args,**_kwargs): raise AssertionError('Rejected image baseline reached dump')
        with patch.object(backup.periodic,'pc_database'), patch.object(backup,'assert_database_quiet'), \
             patch.object(backup,'image_references',return_value=['avatars/member-1/live.webp']), \
             patch.object(backup,'database_fingerprint',return_value={'synthetic':'stable'}):
            for fault in ('missing','hash-changed','size-changed','extra-upload','default-empty','now-referenced'):
                with self.subTest(fault=fault):
                    current = copy.deepcopy(config)
                    if fault=='missing': path.unlink()
                    if fault=='hash-changed': path.write_bytes(b'X'*len(data))
                    if fault=='size-changed': path.write_bytes(data+b'new bytes')
                    if fault=='extra-upload': extra.write_bytes(b'new unsaved upload'); extra.chmod(0o600); os.chown(extra,65530,65530)
                    if fault=='default-empty': current.pop('retainedUnreferencedImages')
                    before = {p.name:p.read_bytes() for p in path.parent.iterdir()}
                    stage = Path(config['stageRoot'])/fault; stage.mkdir(mode=0o700)
                    refs = ['avatars/member-1/live.webp'] + ([key] if fault=='now-referenced' else [])
                    with patch.object(backup,'image_references',return_value=refs), self.assertRaises(backup.BackupFailure):
                        backup.capture_bundle(current,NoDump(),stage)
                    self.assertEqual({p.name:p.read_bytes() for p in path.parent.iterdir()},before)
                    self.assertEqual(receipt.read_bytes(),b'old verified receipt'); self.assertEqual(list(stage.iterdir()),[])
                    if extra.exists(): extra.unlink()
                    path.write_bytes(data); path.chmod(0o600); os.chown(path,65530,65530)

    def test_retained_baseline_cannot_bypass_before_after_image_change_check(self):
        config,images = self.retained_images_fixture(); path,data = next(iter(images.values()))
        receipt = Path(config['receiptFile']); receipt.write_bytes(b'old verified receipt'); receipt.chmod(0o600)
        class ChangingDump:
            def sql(self,_config,_statement): return b''
            def docker(self,*args,output=None):
                output.write(b'PGDMP synthetic dump' if args[2]=='pg_dump' else b'-- synthetic roles')
                if args[2]=='pg_dump': path.write_bytes(data+b'interrupted actor edit')
        with patch.object(backup.periodic,'pc_database'), patch.object(backup,'assert_database_quiet'), \
             patch.object(backup,'image_references',return_value=['avatars/member-1/live.webp']), \
             patch.object(backup,'database_fingerprint',return_value={'synthetic':'stable'}), \
             patch.object(backup,'pc_vault_key',return_value=b'c'*64+b'\n'), \
             patch.object(backup,'vault_fingerprint',return_value={'rows':2,'sha256':'d'*64}), \
             patch.object(backup.periodic,'bind_storage'), patch.object(backup.periodic.os,'statvfs',return_value=SimpleNamespace(f_bavail=1048576,f_frsize=4096,f_favail=10000)), \
             patch.object(Path,'read_text',autospec=True,side_effect=lambda path: 'MemAvailable: 65536 kB\n' if str(path)=='/proc/meminfo' else self.fail('Unexpected memory observation')):
            with self.assertRaisesRegex(backup.BackupFailure,'Capture changed'):
                backup.capture_bundle(config,ChangingDump(),Path(config['stageRoot']))
        self.assertEqual(path.read_bytes(),data+b'interrupted actor edit')
        self.assertEqual(receipt.read_bytes(),b'old verified receipt')

    def test_captured_status_is_manifest_hashed_restored_and_capture_change_refused(self):
        self.scheduler_state()
        root = Path(self.config['jobsStateRoot'])
        before = {name: (root/name).read_bytes() for name in ('journal.json', 'status.json')}
        class CaptureCommands:
            def __init__(self, mutate=False): self.mutate = mutate
            def sql(self, *_args): return b''
            def docker(self, *args, output=None):
                output.write(b'PGDMP synthetic dump' if args[2] == 'pg_dump' else b'-- synthetic role SQL')
                if self.mutate:
                    path = root/'status.json'
                    value = json.loads(path.read_bytes()); value['checkedAt'] = '2025-01-02T00:00:06.000Z'
                    path.write_bytes(json.dumps(value).encode())
        with patch.object(backup, 'assert_database_quiet'), patch.object(backup, 'image_references', return_value=[]), \
             patch.object(backup, 'database_fingerprint', return_value={'synthetic': 'stable'}):
            bundle, manifest = backup.capture_bundle(self.config, CaptureCommands(), Path(self.config['stageRoot']))
            self.assertEqual({row['name'] for row in manifest['jobs']}, set(before))
            restored = self.root/'restored-status'; restored.mkdir(mode=0o700)
            result = backup.verified_extract(bundle, restored, self.config['sourceId'])
            self.assertEqual(result, manifest)
            self.assertEqual(before, {name: (restored/'jobs'/name).read_bytes() for name in before})
            self.assertEqual(before, {name: (root/name).read_bytes() for name in before})
            second = self.root/'changed-capture'; second.mkdir(mode=0o700)
            with self.assertRaisesRegex(backup.BackupFailure, 'Capture changed'):
                backup.capture_bundle(self.config, CaptureCommands(mutate=True), second)
        self.assertFalse(Path(self.config['receiptFile']).exists())

    def test_running_dispatch_rejected_uncertain_history_preserved_verbatim(self):
        path, value = self.journal('running')
        with self.assertRaisesRegex(backup.BackupFailure, 'dispatch'): backup.journal_snapshot(path.parent)
        self.assertEqual(path.read_bytes(), value)
        path, value = self.journal('uncertain')
        rows = backup.journal_snapshot(path.parent)
        self.assertEqual(rows[0]['bytes'], value)
        self.assertEqual(path.read_bytes(), value)
        (path.parent / 'journal.json.tmp').write_bytes(value)
        with self.assertRaisesRegex(backup.BackupFailure, 'interrupted'): backup.journal_snapshot(path.parent)

    def test_private_images_reject_partial_upload_symlink_and_hardlink(self):
        root = Path(self.config['imageRoot'])
        path = root / '.upload-partial'; path.write_bytes(b'temporary'); path.chmod(0o600)
        with self.assertRaises(backup.BackupFailure): backup.image_inventory(root)
        path.unlink(); (root / 'alias').symlink_to(self.config['runtimeKey'])
        with self.assertRaises(backup.BackupFailure): backup.image_inventory(root)
        (root / 'alias').unlink(); os.link(self.config['runtimeKey'], root / 'alias')
        with self.assertRaises(backup.BackupFailure): backup.image_inventory(root)

    def test_active_transaction_and_claimed_push_do_not_advance_receipt(self):
        class Sql:
            def __init__(self, answers): self.answers = iter(answers)
            def sql(self, *_args): return next(self.answers)
        with self.assertRaisesRegex(backup.BackupFailure, 'DB writer'):
            backup.assert_database_quiet(self.config, Sql([b'1\n0\n0\n0\n0\n0\n']))
        with self.assertRaisesRegex(backup.BackupFailure, 'Push dispatch'):
            backup.assert_database_quiet(self.config, Sql([b'0\n0\n0\n0\n0\n0\n', b't\n', b'1\n']))

    def test_archive_path_escape_and_symlink_never_publish(self):
        for name, symbolic in (('../escaped', False), ('/absolute', False), ('images/alias', True)):
            archive = self.root / 'bad.tar'
            with tarfile.open(archive, 'w') as out:
                item = tarfile.TarInfo(name); item.size = 1
                if symbolic: item.type = tarfile.SYMTYPE; item.linkname = '/etc/passwd'; item.size = 0
                out.addfile(item, None if symbolic else io.BytesIO(b'x'))
            dest = self.root / ('restore' + str(symbolic) + str(len(name))); dest.mkdir(mode=0o700)
            with self.assertRaises(backup.BackupFailure): backup.verified_extract(archive, dest, 'unit-synthetic')
            self.assertFalse((self.root.parent / 'escaped').exists())

    def test_slow_verification_runs_only_after_resume_and_failure_preserves_prior_receipt(self):
        receipt = Path(self.config['receiptFile'])
        original = b'{"version":1,"verifiedAt":"old-proof-must-stay"}'
        receipt.write_bytes(original); receipt.chmod(0o600)
        captured_at = backup.stamp()
        manifest = {'fixture': True, 'capturedAt': captured_at,
                    'recoveryKeyFingerprint': backup.hashlib.sha256(b'k'*32).hexdigest()}
        def capture(_config, _commands, stage):
            path = stage / 'bundle.tar'; path.write_bytes(b'fixture encrypted archive'); path.chmod(0o600)
            return path, manifest
        with patch.object(backup, 'capture_bundle', capture), \
             patch.object(backup, 'verified_extract', return_value=manifest), \
             patch.object(backup, 'verify_restore', side_effect=backup.BackupFailure('independent restore mismatch')):
            with self.assertRaisesRegex(backup.BackupFailure, 'restore mismatch'): backup.produce(self.config, self.commands)
        self.assertEqual(receipt.read_bytes(), original)
        self.assertEqual(self.commands.events[6], ('verification', 'encrypt'))
        self.assertEqual(json.loads((receipt.parent / 'capture-state.json').read_text())['phase'], 'resumed')
        self.assertEqual(list(Path(self.config['stageRoot']).iterdir()), [])

    def test_interrupted_checkpoint_blocks_automatic_restart_and_receipt_replay(self):
        backup.atomic_json(Path(self.config['backupRoot']) / 'capture-state.json', {'phase': 'capturing'})
        with self.assertRaisesRegex(backup.BackupFailure, 'operator recovery'): backup.produce(self.config, self.commands)
        self.assertEqual(self.commands.events, [])
        self.assertFalse(Path(self.config['receiptFile']).exists())

    def test_second_producer_cannot_own_same_capture_window(self):
        root = Path(self.config['backupRoot'])
        fd = os.open(root / 'backup.lock', os.O_RDWR | os.O_CREAT, 0o600)
        try:
            backup.fcntl.flock(fd, backup.fcntl.LOCK_EX | backup.fcntl.LOCK_NB)
            with self.assertRaisesRegex(backup.BackupFailure, 'already owns'): backup.produce(self.config, self.commands)
        finally: os.close(fd)
        self.assertEqual(self.commands.events, [])

    def periodic_producer_fixture(self, pc=True):
        config = {**self.config, 'jobsReceiptFile':str(self.root/'reader/verified.json')}
        config['periodic'] = {key:bounds[0] for key,bounds in backup.periodic.LIMITS.items()}
        config['periodic'].update(enabled=True, controlSeal=str(self.root/'seal.json'),
            configPath=str(self.root/'backup.json'), allowUntil='2099-01-01T00:00:00+00:00')
        config['periodic']['maxTotalArchiveBytes'] += 36
        if pc:
            config.update(profile='pc-private', writerMode='surface-systemd', sourceOwnerUid=65530,
                containers={role:'tuat-local-'+role for role in ('db','auth','rest')})
        return config

    def test_pc_producer_completes_local_publication_before_one_offsite_call(self):
        for pc in (True, False):
            config = self.periodic_producer_fixture(pc)
            events = []; result = {'ok':True, 'archive':'synthetic.enc'}
            class Attempt:
                def __init__(self,*_args): events.append('admitted')
                def finish(self,value):
                    self_test.assertIs(value,result); events.append('local-publication')
                def transfer_offsite(self,value):
                    self_test.assertIs(value,result)
                    self_test.assertEqual(events,['admitted','capture-cleaned','local-publication'])
                    events.append('offsite')
                def hold(self): events.append('held')
            self_test = self
            def captured(*_args): events.append('capture-cleaned'); return result
            with patch.object(backup.periodic,'placement',return_value=backup.periodic.installation_profile(config)), \
                 patch.object(backup.periodic,'Attempt',Attempt), patch.object(backup,'produce_locked',captured):
                self.assertIs(backup.produce(config,self.commands),result)
            self.assertEqual(events,['admitted','capture-cleaned','local-publication']+(['offsite'] if pc else []))

    def test_pc_offsite_ack_lost_after_publication_holds_without_rollback_or_resend(self):
        config = self.periodic_producer_fixture()
        canonical = self.root/'node-receipt.json'; canonical.write_bytes(b'prior')
        events = []; result = {'ok':True, 'archive':'synthetic.enc'}
        class Attempt:
            def __init__(self,*_args): pass
            def finish(self,_value): events.append('local-publication')
            def transfer_offsite(self,_value):
                events.append('offsite')
                canonical.write_bytes(b'committed-before-ack-loss')
                raise backup.periodic.Hold('periodic-offsite-ack')
            def hold(self): events.append('held')
        with patch.object(backup.periodic,'placement',return_value=backup.periodic.installation_profile(config)), \
             patch.object(backup.periodic,'Attempt',Attempt), patch.object(backup,'produce_locked',return_value=result):
            with self.assertRaisesRegex(backup.periodic.Hold,'periodic-offsite-ack'):
                backup.produce(config,self.commands)
        self.assertEqual(events,['local-publication','offsite','held'])
        self.assertEqual(canonical.read_bytes(),b'committed-before-ack-loss')

    def test_directory_sync_failure_keeps_prior_receipt_and_stops_acknowledgement(self):
        path = Path(self.config['receiptFile']); path.write_bytes(b'{"verifiedAt":"old"}'); path.chmod(0o600)
        calls = 0
        original = backup.sync_directory
        def sync(directory):
            nonlocal calls
            calls += 1
            if calls == 2: raise OSError('directory fsync failure after rename')
            original(directory)
        with patch.object(backup, 'sync_directory', sync):
            with self.assertRaises(OSError): backup.atomic_json(path, {'verifiedAt': 'new'})
        self.assertEqual(path.read_bytes(), b'{"verifiedAt":"old"}')

    def test_external_thaw_during_capture_cannot_pass_unchanged_fingerprint(self):
        window = self.window(); window.enter()
        self.commands.states['fixture-app']['State']['Paused'] = False
        with self.assertRaisesRegex(backup.BackupFailure, 'no longer frozen'): window.verify_frozen()
        window.restore()

    def test_periodic_runtime_does_not_require_cold_copy_and_old_snapshot_cannot_be_refreshed(self):
        del self.config['recoveryKeyCopy']
        captured_at = (backup.dt.datetime.now(backup.dt.timezone.utc)-backup.dt.timedelta(hours=1)).isoformat()
        manifest = {'capturedAt': captured_at, 'recoveryKeyFingerprint': backup.hashlib.sha256(b'k'*32).hexdigest()}
        def capture(_config, _commands, stage):
            path=stage/'bundle.tar'; path.write_bytes(b'fixture encrypted archive'); path.chmod(0o600)
            return path, manifest
        with patch.object(backup,'capture_bundle',capture), patch.object(backup,'verified_extract',return_value=manifest), \
             patch.object(backup,'verify_restore',return_value={'databaseTables':1,'images':0}):
            with self.assertRaisesRegex(backup.BackupFailure,'became stale'): backup.produce(self.config,self.commands)
        self.assertFalse(Path(self.config['receiptFile']).exists())
        self.assertIn(('verification','decrypt'),self.commands.events)

    def test_changed_recovery_copy_fails_before_freeze(self):
        Path(self.config['recoveryKeyCopy']).write_bytes(b'x'*32)
        with self.assertRaisesRegex(backup.BackupFailure,'copy differ'): backup.produce(self.config,self.commands)
        self.assertEqual(self.commands.events,[])

    def test_root_metadata_publication_uses_actual_sealed_reader_group_and_preserves_legacy(self):
        for gid in (1000, 65530):
            parent = self.root / ('reader-' + str(gid)); parent.mkdir(mode=0o750)
            os.chown(parent, 0, gid); parent.chmod(0o750)
            path = parent / 'verified.json'
            backup.atomic_jobs_json(path, {'version': 1}, reader_gid=gid)
            self.assertEqual((path.stat().st_uid, path.stat().st_gid, path.stat().st_mode & 0o777), (0, gid, 0o640))
            original = path.read_bytes()
            with self.assertRaisesRegex(backup.BackupFailure, 'directory contract'): backup.atomic_jobs_json(path, {'version': 2}, reader_gid=65530 if gid == 1000 else 1000)
            self.assertEqual(path.read_bytes(), original)
            os.chown(path, 0, 1000 if gid == 65530 else 65530)
            with self.assertRaisesRegex(backup.BackupFailure, 'file contract'): backup.atomic_jobs_json(path, {'version': 2}, reader_gid=gid)
            self.assertEqual(path.read_bytes(), original)

    def test_private_command_transport_and_split_journal_owner_do_not_use_default_daemon(self):
        config = {**self.config, 'profile': 'pc-private', 'sourceOwnerUid': 65530}
        self.assertEqual(backup.jobs_owner(config), 0)
        self.assertEqual(backup.jobs_owner({**self.config, 'sourceOwnerUid': 65530}), 65530)
        commands = backup.LocalCommands({'profile': 'pc-private'})
        events = []
        commands.run = lambda args, **_kwargs: events.append(args) or b''
        commands.sql({**config, 'containers': {'db': 'tuat-local-db'}}, 'SELECT 1;')
        self.assertEqual(events[0][:5], ['docker', '--host', 'unix:///run/tuat-local/docker.sock', '--config', '/nonexistent'])
        self.assertIn('--host=/tmp', events[0]); self.assertIn('--port=18304', events[0])
        events.clear(); commands.sql({**config, 'containers': {'db': 'tuat-backup-verify-synthetic'}}, 'SELECT 1;')
        self.assertNotIn('--port=18304', events[0])

    def test_private_capture_refuses_different_database_before_any_sql_dump_or_stage_bytes(self):
        config = {**self.config,'profile':'pc-private','database':'other_valid_database'}
        runtime = {'profile':'pc-private','sourceId':config['sourceId'],**{key:str(backup.periodic.MOUNT/key) for key in
            ('dbEnvironmentFile','authEnvironmentFile','restEnvironmentFile')}}
        envs = {'dbEnvironmentFile':b'PGDATA=/var/lib/postgresql/data\nPOSTGRES_USER=postgres\nPOSTGRES_PASSWORD=synthetic\nPOSTGRES_DB=fixture\n',
            'authEnvironmentFile':b'GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:synthetic@127.0.0.1:18304/fixture?search_path=auth\n',
            'restEnvironmentFile':b'PGRST_DB_URI=postgres://authenticator:synthetic@127.0.0.1:18304/fixture\n'}
        def protected(path, _private):
            data = envs[Path(path).name]
            from types import SimpleNamespace
            return SimpleNamespace(stat=lambda:SimpleNamespace(st_dev=2,st_size=len(data)),read_bytes=lambda:data)
        class NeverCommands:
            def sql(self,*_args): raise AssertionError('Wrong database reached SQL')
            def docker(self,*_args,**_kwargs): raise AssertionError('Wrong database reached dump')
        from types import SimpleNamespace
        with patch.object(backup.periodic,'seal',return_value={'runtimeConfigPath':'/synthetic/runtime'}), \
             patch.object(backup.periodic,'read_json',return_value=runtime), patch.object(backup.periodic,'immutable',side_effect=protected), \
             patch.object(Path,'stat',return_value=SimpleNamespace(st_dev=2)):
            with self.assertRaisesRegex(backup.periodic.Hold,'database-binding'):
                backup.capture_bundle(config,NeverCommands(),Path(self.config['stageRoot']))
        self.assertEqual(list(Path(self.config['stageRoot']).iterdir()),[])

    def test_private_daemon_identity_is_preserved_and_never_frozen_or_thawed(self):
        self.host(); self.config['profile'] = 'pc-private'
        for index, name in enumerate(backup.periodic.PC_DAEMONS):
            self.commands.units[name] = {**self.commands.units[backup.UNITS[0]], 'MainPID': str(900+index),
                'InvocationID': ('a' if index == 0 else 'b')*32, 'ControlGroup': '/system.slice/'+name}
        window = self.window(); window.enter(); window.verify_frozen(); window.restore()
        self.assertFalse(any(name in backup.periodic.PC_DAEMONS for name, _ in self.commands.events))
        self.commands.units[backup.periodic.PC_DAEMONS[0]]['MainPID'] = '999'
        with self.assertRaisesRegex(backup.BackupFailure, 'daemon identity'): window.verify_preserved_units()

    def test_unknown_schema_cannot_escape_full_dump_comparison(self):
        class Sql:
            def sql(self,*_args): return b'0\n0\n0\n0\n1\n0\n'
        with self.assertRaisesRegex(backup.BackupFailure,'unsupported schema'): backup.assert_database_quiet(self.config,Sql())

    def test_unknown_held_jobs_lock_refuses_before_any_freeze(self):
        path=Path(self.config['jobsStateRoot'])/'runner.lock'
        path.write_text(json.dumps({'version':1,'pid':922,'startedAt':backup.stamp()}));path.chmod(0o600)
        with self.assertRaisesRegex(backup.BackupFailure,'outside the verified'): self.window().enter()
        self.assertEqual(self.commands.events,[])


class LinuxLifetimeEvidence(unittest.TestCase):
    def metadata(self):
        return {'version':1, 'service':'jobs', 'pid':os.getpid(),
            'ownerId':'11111111-1111-4111-8111-111111111111',
            'startedAt':backup.dt.datetime.now(backup.dt.timezone.utc).isoformat()}

    def test_journal_retains_linux_lifetime_bytes_without_treating_them_as_live_authority(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); root.chmod(0o700); owner=self.metadata()
            for name,value in (('lifetime.lock',owner),('runner.lock',{k:owner[k] for k in ('pid','startedAt')})):
                path=root/name; path.write_text(json.dumps(value)); path.chmod(0o600)
            rows=backup.journal_snapshot(root)
            self.assertEqual({row['name']:row['bytes'] for row in rows},
                {name:(root/name).read_bytes() for name in ('lifetime.lock','runner.lock')})
            owner['service']='app'; (root/'lifetime.lock').write_text(json.dumps(owner))
            with self.assertRaisesRegex(backup.BackupFailure,'lifetime'): backup.journal_snapshot(root)
            owner['service']='jobs'; owner['pid']+=1; (root/'lifetime.lock').write_text(json.dumps(owner))
            with self.assertRaisesRegex(backup.BackupFailure,'disagree'): backup.journal_snapshot(root)

    @unittest.skipUnless(sys.platform=='linux' and os.getuid()==0, 'Native Jobs are Linux/root only')
    def test_real_kernel_flock_is_required_even_when_owner_metadata_looks_valid(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); root.chmod(0o700); path=root/'lifetime.lock'
            path.write_text(json.dumps(self.metadata())); path.chmod(0o600)
            with self.assertRaisesRegex(backup.BackupFailure,'FLOCK'): backup.verify_kernel_jobs_lock(root,os.getpid())
            with path.open('rb') as stream:
                backup.fcntl.flock(stream,backup.fcntl.LOCK_EX|backup.fcntl.LOCK_NB)
                backup.verify_kernel_jobs_lock(root,os.getpid())
                backup.fcntl.flock(stream,backup.fcntl.LOCK_UN)
                with self.assertRaisesRegex(backup.BackupFailure,'FLOCK'): backup.verify_kernel_jobs_lock(root,os.getpid())


class BoundedCaptureWrite(unittest.TestCase):
    def test_large_child_output_is_drained_before_expensive_capacity_revalidation(self):
        commands=backup.LocalCommands()
        commands.periodic_attempt=SimpleNamespace(config={},deadline=lambda:None)
        expected=b'x'*(4*1024**2+37)
        with tempfile.TemporaryFile() as output, \
             patch.object(backup.periodic,'policy',return_value={'maxArchiveBytes':8*1024**2}), \
             patch.object(backup.periodic,'capacity') as capacity:
            commands.run([sys.executable,'-I','-c','import sys;sys.stdout.buffer.write(b"x"*(4*1024**2+37))'],output=output)
            output.seek(0);self.assertEqual(output.read(),expected)
            self.assertEqual(capacity.call_count,2)

    def test_small_tar_writes_preserve_every_byte_without_rehashing_each_header(self):
        stream=io.BytesIO();config={'periodic':{'maxArchiveBytes':3*1024**2}}
        with patch.object(backup.periodic,'policy',return_value=config['periodic']),patch.object(backup.periodic,'capacity') as check:
            bundle=backup.BoundedBundle(stream,config)
            for _ in range(4096):bundle.write(b'x'*512)
            self.assertEqual(stream.getvalue(),b'x'*(2*1024**2))
            self.assertGreaterEqual(check.call_count,2)
            self.assertLessEqual(check.call_count,3)

    def test_new_capacity_hold_and_archive_limit_stop_before_dispatching_bytes(self):
        stream=io.BytesIO();config={'periodic':{'maxArchiveBytes':2*1024**2}}
        with patch.object(backup.periodic,'policy',return_value=config['periodic']), \
             patch.object(backup.periodic,'capacity',side_effect=[{},backup.periodic.Hold('storage-capacity')]):
            bundle=backup.BoundedBundle(stream,config);bundle.write(b'x'*512)
            with self.assertRaisesRegex(backup.periodic.Hold,'storage-capacity'):bundle.write(b'y'*1024**2)
            self.assertEqual(stream.getvalue(),b'x'*512)
        with patch.object(backup.periodic,'policy',return_value=config['periodic']),patch.object(backup.periodic,'capacity') as check:
            bundle=backup.BoundedBundle(io.BytesIO(),config)
            with self.assertRaisesRegex(backup.BackupFailure,'byte bound'):bundle.write(b'x'*(3*1024**2))
            check.assert_not_called()


class FingerprintStream(unittest.TestCase):
    marker=b'tuat-copy-'+b'a'*32+b':'

    def fingerprint(self, directory, tables, payload):
        class Commands:
            calls=0
            def sql(self,_config,statement,output):
                self.calls+=1
                output.write(payload)
        commands=Commands()
        with patch.object(backup.secrets,'token_hex',return_value='a'*32):
            result=backup.table_fingerprints({'stageRoot':directory},commands,tables,'to_jsonb(t)::text')
        self.assertEqual(commands.calls,1)
        return result

    def test_same_copy_bytes_hashes_and_counts_in_one_bounded_stream(self):
        rows=b'{"id":1,"text":"line\\nnext\\tvalue tuat-copy-'+b'a'*32+b':END"}\n'+b'{"id":2,"text":null}\n'
        payload=self.marker+b'public.first\n'+self.marker+b'ROWS:2\n'+rows+self.marker+b'public.empty\n'+self.marker+b'ROWS:0\n'+self.marker+b'END\n'
        with tempfile.TemporaryDirectory() as directory:
            actual=self.fingerprint(directory,['public.first','public.empty'],payload)
            self.assertEqual(actual,{'public.first':{'sha256':hashlib.sha256(rows).hexdigest(),'rows':2,'bytes':len(rows)},
                                     'public.empty':{'sha256':hashlib.sha256(b'').hexdigest(),'rows':0,'bytes':0}})
            self.assertEqual(list(Path(directory).iterdir()),[])

    def test_truncation_reordering_extra_output_and_invalid_rows_cannot_verify(self):
        start=self.marker+b'public.first\n'+self.marker+b'ROWS:1\n';end=self.marker+b'END\n';row=b'{"id":1}\n'
        payloads=[start+row,start+row+end+end,start+row+end+row,
                  self.marker+b'public.wrong\n'+row+end,start+b'COPY 1\n'+end,
                  start+b'{"id":1}'+end,end,start.replace(b'ROWS:1',b'ROWS:2')+row+end,
                  start+row+self.marker+b'ROWS:1\n'+end]
        with tempfile.TemporaryDirectory() as directory:
            for payload in payloads:
                with self.subTest(payload=payload),self.assertRaises(backup.BackupFailure):
                    self.fingerprint(directory,['public.first'],payload)

    def test_untrusted_table_identifier_is_refused_before_database_access(self):
        class Commands:
            def sql(self,*_args):raise AssertionError('Untrusted identifier reached SQL')
        with tempfile.TemporaryDirectory() as directory:
            for name in ('public.x;SELECT 1','other.public.x','public."quoted"'):
                with self.assertRaisesRegex(backup.BackupFailure,'table name'):
                    backup.table_fingerprints({'stageRoot':directory},Commands(),[name],'to_jsonb(t)::text')


if __name__ == '__main__': unittest.main()
