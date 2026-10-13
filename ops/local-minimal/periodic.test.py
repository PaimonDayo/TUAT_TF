"""Pure sealed actor tests; observations are injected and no controller runs."""
import importlib.util
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack

spec = importlib.util.spec_from_file_location('periodic', Path(__file__).with_name('periodic.py'))
periodic = importlib.util.module_from_spec(spec); spec.loader.exec_module(periodic)


class PeriodicActor(unittest.TestCase):
    def test_private_profile_requires_matching_sealed_runtime_and_no_default_socket_fallback(self):
        config = {'sourceId': 'synthetic', 'profile': 'pc-private'}
        with patch.object(periodic, 'seal', return_value={'runtimeConfigPath': '/synthetic/runtime'}), \
             patch.object(periodic, 'read_json', return_value={'sourceId': 'synthetic', 'profile': 'pc-private'}), patch.object(periodic, 'pc_database') as database:
            self.assertEqual(periodic.placement(config)['socket'], 'unix:///run/tuat-local/docker.sock')
            database.assert_called_once_with(config, {'sourceId':'synthetic','profile':'pc-private'})
        with patch.object(periodic, 'seal', return_value={'runtimeConfigPath': '/synthetic/runtime'}), patch.object(periodic, 'read_json', return_value={'sourceId': 'synthetic'}):
            with self.assertRaisesRegex(periodic.Hold, 'profile-binding'): periodic.placement(config)
        with patch.object(periodic, 'seal', side_effect=periodic.Hold('unverified')):
            with self.assertRaisesRegex(periodic.Hold, 'unverified'): periodic.placement(config)
        self.assertEqual(periodic.placement({})['socket'], periodic.SOCKET)

    def test_private_backup_database_is_bound_to_sealed_runtime_env_and_both_service_uris(self):
        config = {'profile':'pc-private','sourceId':'synthetic','database':'fixture'}
        runtime = {'profile':'pc-private','sourceId':'synthetic',**{key:str(periodic.MOUNT/key) for key in
            ('dbEnvironmentFile','authEnvironmentFile','restEnvironmentFile')}}
        envs = {'dbEnvironmentFile':b'PGDATA=/var/lib/postgresql/data\nPOSTGRES_USER=postgres\nPOSTGRES_PASSWORD=synthetic\nPOSTGRES_DB=fixture\n',
            'authEnvironmentFile':b'GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:synthetic@127.0.0.1:18304/fixture?search_path=auth\n',
            'restEnvironmentFile':b'PGRST_DB_URI=postgres://authenticator:synthetic@127.0.0.1:18304/fixture\n'}
        def protected(path, private):
            self.assertTrue(private)
            data = envs[Path(path).name]
            return SimpleNamespace(stat=lambda:SimpleNamespace(st_dev=2,st_size=len(data)), read_bytes=lambda:data)
        with patch.object(periodic,'seal',return_value={'runtimeConfigPath':'/synthetic/runtime'}), patch.object(periodic,'read_json',return_value=runtime), \
             patch.object(periodic,'immutable',side_effect=protected), patch.object(Path,'stat',return_value=SimpleNamespace(st_dev=2)):
            self.assertEqual(periodic.placement(config)['socket'],'unix:///run/tuat-local/docker.sock')
            with self.assertRaisesRegex(periodic.Hold,'database-binding'):
                periodic.pc_database({**config,'database':'other_valid_database'})
            for key in ('authEnvironmentFile','restEnvironmentFile'):
                prior = envs[key]; envs[key] = prior.replace(b'/fixture',b'/other_valid_database')
                with self.assertRaisesRegex(periodic.Hold,'database-uri'): periodic.pc_database(config)
                envs[key] = prior
            with patch.object(periodic,'immutable',side_effect=periodic.Hold('periodic-immutable-file')):
                with self.assertRaisesRegex(periodic.Hold,'immutable-file'): periodic.pc_database(config)
            with patch.object(periodic,'seal',side_effect=periodic.Hold('periodic-install-pin')):
                with self.assertRaisesRegex(periodic.Hold,'install-pin'): periodic.pc_database(config)
        with patch.object(periodic,'seal') as seal:
            periodic.pc_database({'database':'legacy'}); seal.assert_not_called()

    def test_actor_comes_from_sealed_private_runtime_not_an_independent_backup_gid(self):
        for uid, gid in ((1000, 1000), (65530, 65530), (65530, 65531)):
            config = {'sourceId': 'synthetic', 'sourceOwnerUid': uid, 'appGid': 1000}
            runtime = {'sourceId': 'synthetic', 'appUid': uid, 'appGid': gid}
            with patch.object(periodic, 'seal', return_value={'runtimeConfigPath': '/synthetic/sealed-runtime.json'}) as seal, \
                 patch.object(periodic, 'read_json', return_value=runtime) as read:
                self.assertEqual(periodic.actor(config), (uid, gid))
                seal.assert_called_once_with(config); read.assert_called_once_with('/synthetic/sealed-runtime.json')

    def test_unsealed_invalid_or_different_source_actor_is_refused(self):
        config = {'sourceId': 'synthetic', 'sourceOwnerUid': 65530}
        good = {'sourceId': 'synthetic', 'appUid': 65530, 'appGid': 65530}
        for field, value in (('appUid', 1000), ('appGid', 0), ('appGid', True), ('appUid', '65530'), ('appUid', 65530.0), ('sourceId', 'other')):
            runtime = {**good, field: value}
            with patch.object(periodic, 'seal', return_value={'runtimeConfigPath': '/synthetic/runtime.json'}), patch.object(periodic, 'read_json', return_value=runtime):
                with self.assertRaises(periodic.Hold): periodic.actor(config)
        with patch.object(periodic, 'seal', side_effect=periodic.Hold('periodic-install-pin')), patch.object(periodic, 'read_json') as read:
            with self.assertRaisesRegex(periodic.Hold, 'periodic-install-pin'): periodic.actor(config)
            read.assert_not_called()

    @unittest.skipUnless(hasattr(os, 'chown'), 'Unix ownership fixture requires chown')
    def test_storage_binding_metadata_reader_matches_actual_actor_not_fixed_1000(self):
        # Only this fresh temporary tree is created/chowned. Device/mount and seal
        # observations are synthetic; no actual encrypted storage is inspected.
        with tempfile.TemporaryDirectory() as directory:
            mount = Path(directory); mount.chmod(0o700)
            config = {'sourceId': 'synthetic', 'sourceOwnerUid': 65530, 'periodic': {}}
            for key in ('imageRoot', 'jobsStateRoot', 'backupRoot', 'stageRoot'):
                path = mount/key; path.mkdir(mode=0o700); config[key] = str(path)
                if key in ('imageRoot', 'jobsStateRoot'): os.chown(path, 65530, 65530)
            for key in ('runtimeKey', 'controlSeal', 'configPath'):
                path = mount/key; path.write_bytes(b'synthetic'); path.chmod(0o600)
                (config['periodic'] if key in ('controlSeal', 'configPath') else config)[key] = str(path)
            config['receiptFile'] = str(mount/'backupRoot/verified.json')
            meta = mount/'metadata'; meta.mkdir(mode=0o750); os.chown(meta, 0, 65530); meta.chmod(0o750)
            receipt = meta/'jobs.json'; receipt.write_bytes(b'{}'); os.chown(receipt, 0, 65530); receipt.chmod(0o640)
            config['jobsReceiptFile'] = str(receipt)
            real_stat = Path.stat
            def observed_stat(path, *args, **kwargs):
                if str(path) == '/': return SimpleNamespace(st_dev=-1)
                return real_stat(path, *args, **kwargs)
            def observed_read(path):
                if str(path) == '/proc/self/mountinfo': return f'1 0 0:1 / {mount} rw - ext4 /dev/synthetic rw\n'.encode()
                raise AssertionError('Unexpected private/mount read')
            with patch.object(periodic, 'MOUNT', mount), patch.object(periodic, 'actor', return_value=(65530, 65530)), \
                 patch.object(periodic, 'policy', return_value=config['periodic']), patch.object(Path, 'stat', observed_stat), \
                 patch.object(Path, 'read_bytes', observed_read):
                periodic.bind_storage(config)
                os.chown(receipt, 0, 1000)
                with self.assertRaisesRegex(periodic.Hold, 'receipt-group'): periodic.bind_storage(config)
                os.chown(receipt, 0, 65530); os.chown(meta, 0, 1000)
                with self.assertRaisesRegex(periodic.Hold, 'metadata-owner'): periodic.bind_storage(config)


class PeriodicOffsite(unittest.TestCase):
    def fixture(self, directory, unknown=False):
        root = Path(directory); backup = root/'backup'; state = root/'offsite'; backup.mkdir(); state.mkdir()
        cfg = {'profile': 'pc-private', 'sourceId': '11111111-1111-4111-8111-111111111111', 'database': 'fixture',
               'backupRoot': str(backup), 'receiptFile': str(backup/'receipt.json'), 'jobsReceiptFile': str(root/'jobs.json'),
               'imageRoot': '/var/lib/tuat-local/images', 'periodic': {'enabled': True, 'maxCycleSeconds': 600}}
        cfg['periodic'].update({key:bounds[0] for key, bounds in periodic.LIMITS.items() if key != 'maxCycleSeconds'})
        cfg['periodic'].update(controlSeal=str(root/'seal.json'), configPath=str(root/'config.json'), allowUntil='2099-01-01T00:00:00+00:00')
        cfg['periodic']['maxTotalArchiveBytes'] += 36
        archive = backup/'one.enc'; archive.write_bytes(b'TUATPC01'+b'synthetic-encrypted-only'*2)
        hashed = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
        now = dt.datetime.now(dt.timezone.utc)
        capture = now-dt.timedelta(seconds=2); restore = now-dt.timedelta(seconds=1)
        receipt = {'version': 1, 'sourceId': cfg['sourceId'], 'databaseSystemIdentifier': '1234567890123456789',
                   'imageRoot': cfg['imageRoot'], 'verifiedAt': capture.isoformat(), 'restoreVerifiedAt': restore.isoformat(),
                   'archiveSha256': hashed(archive), 'independentRecoveryCopyChecked': True}
        result = {'ok': True, 'archive': archive.name, 'receipt': receipt}
        template = {'profile': 'pc-private', 'sourceId': cfg['sourceId'], 'stateDirectory': str(state), 'archiveFile': '/unused/template.enc',
                    'producerReceiptFile': cfg['receiptFile'], 'imageRoot': cfg['imageRoot']}
        installed = {'nodePath': '/opt/node-v24.19.0-linux-x64/bin/node', 'sources': {'offsite.mjs': {'path': '/sealed/offsite.mjs'}}}
        writes = []
        def write(path, value):
            writes.append((str(path), dict(value))); Path(path).write_text(json.dumps(value, sort_keys=True))
        write(backup/'capture-state.json', {'phase': 'resumed'})
        normalize = lambda value: value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        stamp = normalize(capture).replace(':', '-').replace('.', '-')
        target = state/'local-snapshot.json'; dispatch = []
        def run(args, **kwargs):
            dispatch.append((args, kwargs))
            snapshot = {'format': 'tuat-local-db-images-v1', 'sourceId': cfg['sourceId'],
                        'generation': '22222222-2222-4222-8222-222222222222', 'databaseSystemIdentifier': receipt['databaseSystemIdentifier'],
                        'imageRoot': cfg['imageRoot'], 'archiveSha256': receipt['archiveSha256'], 'archiveBytes': archive.stat().st_size,
                        'archiveKey': 'ops/pc-backend/'+cfg['sourceId']+'/backups/'+stamp+'.local.tar.enc',
                        'capturedAt': normalize(capture), 'restoreVerifiedAt': normalize(restore),
                        'offsiteVerifiedAt': normalize(now), 'independentRecoveryCopyChecked': True}
            write(target, snapshot)
            if unknown: raise TimeoutError('Synthetic ACK lost after canonical publication')
            return json.dumps({'verified': True, 'sourceId': cfg['sourceId'], 'receipt': str(target)}).encode()
        commands = SimpleNamespace(storage_gate=lambda config: None, run=run)
        stack = ExitStack(); self.addCleanup(stack.close)
        stack.enter_context(patch.object(periodic, 'verify_self', return_value={'synthetic': True}))
        stack.enter_context(patch.object(periodic, 'capacity', return_value={}))
        stack.enter_context(patch.object(periodic, 'seal', return_value=installed))
        stack.enter_context(patch.object(periodic, 'pc_offsite_inputs', return_value=({'synthetic': True}, template, {})))
        stack.enter_context(patch.object(periodic, 'sender_inventory'))
        stack.enter_context(patch.object(periodic, 'immutable', side_effect=lambda path, private=False: Path(path)))
        stack.enter_context(patch.object(periodic, 'read_json', side_effect=lambda path, **kwargs: json.loads(Path(path).read_text())))
        stack.enter_context(patch.object(periodic, 'defer_signals', side_effect=ExitStack))
        real_stat, real_lstat = Path.stat, Path.lstat
        stack.enter_context(patch.object(Path, 'stat', lambda path, *args, **kwargs: SimpleNamespace(st_dev=2) if path == periodic.MOUNT else real_stat(path, *args, **kwargs)))
        stack.enter_context(patch.object(Path, 'lstat', lambda path, *args, **kwargs: SimpleNamespace(st_uid=0, st_mode=0o40700, st_dev=2) if path == state else real_lstat(path, *args, **kwargs)))
        attempt = periodic.Attempt(cfg, commands, write, hashed, write)
        return SimpleNamespace(attempt=attempt, config=cfg, commands=commands, write=write, hashed=hashed,
                               result=result, template=template, dispatch=dispatch, writes=writes, target=target)

    def test_local_verified_crash_is_held_before_any_sender_dispatch(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            f = self.fixture(directory); f.attempt.finish(f.result)
            self.assertEqual(f.attempt.value['phase'], 'local-verified'); self.assertFalse(f.attempt.published)
            with self.assertRaisesRegex(periodic.Hold, 'prior-unknown-hold'):
                periodic.Attempt(f.config, f.commands, f.write, f.hashed, f.write)
            self.assertEqual(f.dispatch, [])

    def test_one_sender_call_uses_fixed_node_and_overrides_only_verified_archive(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            f = self.fixture(directory); f.attempt.finish(f.result); ack = f.attempt.transfer_offsite(f.result)
            self.assertTrue(ack['verified']); self.assertTrue(f.attempt.published); self.assertEqual(f.attempt.value['phase'], 'verified')
            self.assertEqual(len(f.dispatch), 1)
            args, kwargs = f.dispatch[0]
            self.assertEqual(args[:2], ['/opt/node-v24.19.0-linux-x64/bin/node', '/sealed/offsite.mjs'])
            self.assertEqual(args[-1], '--apply'); self.assertEqual(kwargs, {'timeout': 120})
            invocation = json.loads(Path(args[2]).read_text())
            self.assertEqual(invocation, {**f.template, 'archiveFile': str(Path(f.config['backupRoot'])/'one.enc')})
            with self.assertRaisesRegex(periodic.Hold, 'not-sendable'): f.attempt.transfer_offsite(f.result)
            self.assertEqual(len(f.dispatch), 1)

    def test_lost_ack_never_rolls_back_node_publication_or_replays_after_restart(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            f = self.fixture(directory, unknown=True); f.attempt.finish(f.result)
            with self.assertRaises(TimeoutError): f.attempt.transfer_offsite(f.result)
            committed = f.target.read_bytes(); f.attempt.hold()
            self.assertEqual(f.target.read_bytes(), committed); self.assertEqual(f.attempt.value['phase'], 'unknown-hold')
            with self.assertRaisesRegex(periodic.Hold, 'not-sendable'): f.attempt.transfer_offsite(f.result)
            with self.assertRaisesRegex(periodic.Hold, 'prior-unknown-hold'):
                periodic.Attempt(f.config, f.commands, f.write, f.hashed, f.write)
            self.assertEqual(len(f.dispatch), 1)

    def test_changed_sender_inventory_refuses_without_dispatch(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            f = self.fixture(directory); f.attempt.finish(f.result)
            with patch.object(periodic, 'sender_inventory', side_effect=periodic.Hold('periodic-offsite-sender-inventory')):
                with self.assertRaisesRegex(periodic.Hold, 'sender-inventory'): f.attempt.transfer_offsite(f.result)
            f.attempt.hold(); self.assertEqual(f.dispatch, [])


if __name__ == '__main__': unittest.main()
