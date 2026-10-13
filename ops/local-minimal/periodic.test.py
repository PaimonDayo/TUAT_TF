"""Pure sealed actor tests; observations are injected and no controller runs."""
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

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


if __name__ == '__main__': unittest.main()
