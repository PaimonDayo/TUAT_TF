"""Real Linux FLOCK/exec fixtures. No host/Jobs activation or provider calls."""
import hashlib
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parent
NODE = Path('/opt/tuat-pc-app-candidate-20261013/bin/node')
NODE_HASH = 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12'
ENTRY = r'''import {readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {acquireRunnerLock,acquireManagedRunnerLock,verifyLinuxLifetime} from './runner-lock.mjs';
const configPath=process.argv[2]==='--run'?process.argv[3]:process.argv[2];
const c=JSON.parse(readFileSync(configPath,'utf8'));
try {
  if(c.fixtureMode==='fake') {for(const name of Object.keys(process.env))if(name.startsWith('TUAT_PC_LINUX_'))delete process.env[name];process.env.TUAT_PC_APP_MUTEX_HELD='1';}
  if(c.fixtureMode==='wrong-service')process.env.TUAT_PC_LINUX_LOCK_SERVICE='jobs';
  if(c.fixtureMode==='wrong-fd')process.env.TUAT_PC_LINUX_LOCK_FD='999999';
  if(c.fixtureMode==='replace') {const p=process.env.TUAT_PC_LINUX_LOCK_PATH;const b=readFileSync(p);renameSync(p,p+'.previous');writeFileSync(p,b,{mode:0o600});}
  if(c.fixtureMode==='jobs-run') {
    const {run}=await import(c.fixtureJobsModule);
    await run(configPath,true,{pause:async()=>writeFileSync(configPath,JSON.stringify({...c,enabled:false})),fetchRequest:async()=>{throw Error('No fixture network allowed');}});
    console.log(JSON.stringify({acquired:true,journal:JSON.parse(readFileSync(c.stateDirectory+'/journal.json'))}));
  } else {
    const lock=c.service==='jobs'?acquireManagedRunnerLock(c.stateDirectory,{recoveryMarker:'TUAT_PC_JOBS_MUTEX_HELD'}):acquireRunnerLock(c.stateDirectory);
    if(c.fixtureMode==='environment') {if(['NODE_OPTIONS','NODE_PATH','DOCKER_HOST','DOCKER_CONTEXT','SYNTHETIC_PROVIDER_SECRET'].some(name=>process.env[name]))throw Error('Ambient environment crossed launcher');}
    console.log(JSON.stringify({acquired:true,recovered:lock.recovered,proof:verifyLinuxLifetime(c.stateDirectory,c.service)}));
    if(c.fixtureMode==='crash')process.kill(process.pid,'SIGKILL');
    else if(c.fixtureMode==='hold'){const timer=setInterval(()=>{},1000);process.stdin.resume();process.once('SIGTERM',()=>{clearInterval(timer);lock.release();process.exit(0);});}
    else lock.release();
  }
} catch(error){console.log(JSON.stringify({acquired:false,code:error.code}));process.exitCode=1;}
'''

@unittest.skipUnless(sys.platform == 'linux' and os.geteuid() == 0, 'Linux root fixture required')
class Lifetime(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not NODE.is_file() or hashlib.sha256(NODE.read_bytes()).hexdigest() != NODE_HASH:
            raise RuntimeError('Exact fixture Node24 dependency unavailable')
        cls.base = Path(tempfile.mkdtemp(prefix='codex-linux-lifetime-', dir='/root'))
        cls.binary = cls.base / 'node'; shutil.copyfile(NODE, cls.binary); cls.binary.chmod(0o700)

    @classmethod
    def tearDownClass(cls):
        if cls.base.parent != Path('/root') or not cls.base.name.startswith('codex-linux-lifetime-'):
            raise RuntimeError('Fixture cleanup scope changed')
        shutil.rmtree(cls.base)
        if cls.base.exists(): raise RuntimeError('Fixture resources remained')

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='case-', dir=self.base))
        self.release = self.root / 'release'; self.release.mkdir(mode=0o700)
        self.state = self.root / 'state'; self.state.mkdir(mode=0o700)
        self.private = self.root / 'private'; self.private.mkdir(mode=0o700)
        self.host = self.release / 'ops/pc-host'; self.host.mkdir(parents=True)
        self.jobs = self.release / 'ops/pc-jobs'; self.jobs.mkdir(parents=True)
        self.launcher = self.host / 'linux-launch.py'
        self.launcher.write_text((SOURCE / 'linux-launch.py').read_text().replace(
            "NODE = Path('/opt/node-v24.19.0-linux-x64/bin/node')", 'NODE = Path('+repr(str(self.binary))+')'))
        self.launcher.chmod(0o600)
        shutil.copyfile(SOURCE / 'runner-lock.mjs', self.host / 'runner-lock.mjs')
        self.host.joinpath('run.mjs').write_text(ENTRY)
        self.jobs.joinpath('run.mjs').write_text(ENTRY.replace("'./runner-lock.mjs'", "'../pc-host/runner-lock.mjs'"))
        self.environment = self.private / 'app.env'; self.environment.write_text(''); self.environment.chmod(0o600)
        self.config = self.private / 'config.json'
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None: child.kill()
            child.communicate(timeout=5)

    def prepare(self, mode='exit', service='app', **changes):
        value = {'version':1,'enabled':True,'releaseDirectory':str(self.release),'stateDirectory':str(self.state),
                 'environmentFile':str(self.environment),'fixtureMode':mode,'service':service,**changes}
        self.config.write_text(json.dumps(value)); self.config.chmod(0o600)
        return value

    def start(self, service='app', pin=NODE_HASH, environment=None):
        child = subprocess.Popen(['/usr/bin/python3','-I',str(self.launcher),'--service',service,
                                  '--config',str(self.config),'--node-sha256',pin],
                                 stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=environment)
        self.children.append(child); return child

    def line(self, child):
        self.assertTrue(select.select([child.stdout],[],[],5)[0], 'Fixture startup timed out')
        text = child.stdout.readline(); self.assertTrue(text, child.stderr.read() if child.poll() is not None else 'No fixture result')
        return json.loads(text)

    def legacy(self, pid=2147483646):
        path=self.state/'runner.lock'; data=json.dumps({'pid':pid,'startedAt':'2026-10-13T00:00:00.000Z'})
        path.write_text(data); path.chmod(0o600); return data

    def test_concurrent_exec_flock_and_clean_release(self):
        self.prepare('hold'); first=self.start(); self.assertEqual(self.line(first),{'acquired':True,'recovered':False,'proof':True})
        before=(self.state/'runner.lock').read_bytes(); second=self.start(); out,err=second.communicate(timeout=5)
        self.assertEqual(second.returncode,1); self.assertEqual(out,''); self.assertIn('linux-lifetime-unverified',err)
        self.assertEqual((self.state/'runner.lock').read_bytes(),before)
        first.send_signal(signal.SIGTERM); first.communicate(timeout=5); self.assertEqual(first.returncode,0)
        self.assertFalse((self.state/'runner.lock').exists())
        self.prepare(); third=self.start(); self.assertTrue(self.line(third)['proof']); third.communicate(timeout=5); self.assertEqual(third.returncode,0)

    def test_crash_dead_owner_recovered_only_under_real_kernel_flock(self):
        self.prepare('crash'); first=self.start(); self.assertTrue(self.line(first)['acquired']); first.communicate(timeout=5)
        self.assertEqual(first.returncode,-signal.SIGKILL); self.assertTrue((self.state/'runner.lock').exists())
        self.prepare(); recovered=self.start(); self.assertEqual(self.line(recovered),{'acquired':True,'recovered':True,'proof':True}); recovered.communicate(timeout=5)
        self.assertEqual(recovered.returncode,0); self.assertFalse((self.state/'runner.lock').exists())

    def test_living_or_reused_pid_is_not_stolen(self):
        before=self.legacy(os.getpid()); self.prepare(); child=self.start()
        self.assertEqual(self.line(child),{'acquired':False,'code':'ERR_PC_APP_LOCK_BUSY'}); child.communicate(timeout=5)
        self.assertEqual((self.state/'runner.lock').read_text(),before)

    def test_fake_marker_wrong_service_fd_and_replaced_inode_hold(self):
        for mode in ('fake','wrong-service','wrong-fd','replace'):
            with self.subTest(mode=mode):
                before=self.legacy(); self.prepare(mode); child=self.start()
                self.assertEqual(self.line(child),{'acquired':False,'code':'ERR_PC_APP_LOCK_RECOVERY_GUARD_REQUIRED'})
                child.communicate(timeout=5); self.assertEqual((self.state/'runner.lock').read_text(),before)

    def test_jobs_service_has_distinct_proof_and_dead_recovery(self):
        self.legacy(); self.prepare(service='jobs'); child=self.start('jobs')
        self.assertEqual(self.line(child),{'acquired':True,'recovered':True,'proof':True}); child.communicate(timeout=5)
        self.assertEqual(child.returncode,0)

    def test_ambient_node_hooks_and_provider_credentials_do_not_cross_exec(self):
        self.prepare('environment');environment={**os.environ,'NODE_OPTIONS':'--require=/nonexistent-synthetic-hook',
            'NODE_PATH':'/nonexistent','DOCKER_HOST':'tcp://synthetic.example.test:2375','DOCKER_CONTEXT':'synthetic',
            'SYNTHETIC_PROVIDER_SECRET':'synthetic-only'}
        child=self.start(environment=environment);self.assertTrue(self.line(child)['proof']);child.communicate(timeout=5)
        self.assertEqual(child.returncode,0)

    def test_bad_node_pin_state_mode_redirect_and_hardlink_never_exec(self):
        for mode in ('pin','state','symlink','hardlink','owner'):
            with self.subTest(mode=mode):
                self.prepare()
                if mode=='state':self.state.chmod(0o755)
                if mode=='symlink':self.config.rename(self.config.with_suffix('.saved'));self.config.symlink_to(self.config.with_suffix('.saved'))
                if mode=='hardlink':
                    p=self.state/'lifetime.lock';p.write_text('retained');p.chmod(0o600);os.link(p,self.state/'other-link')
                if mode=='owner':
                    p=self.state/'lifetime.lock';p.write_text('retained');p.chmod(0o600);os.chown(p,65530,0)
                child=self.start(pin='0'*64 if mode=='pin' else NODE_HASH); out,err=child.communicate(timeout=5)
                self.assertEqual(child.returncode,1);self.assertEqual(out,'');self.assertIn('linux-lifetime-unverified',err)
                self.assertFalse((self.state/'runner.lock').exists())
                if mode=='state':self.state.chmod(0o700)
                if mode=='symlink':self.config.unlink();self.config.with_suffix('.saved').rename(self.config)
                if mode=='hardlink':(self.state/'lifetime.lock').unlink();(self.state/'other-link').unlink()
                if mode=='owner':os.chown(self.state/'lifetime.lock',0,0);(self.state/'lifetime.lock').unlink()

    def test_arbitrary_command_is_rejected_without_echoing_arguments(self):
        self.prepare();marker='synthetic-sensitive-marker'
        result=subprocess.run(['/usr/bin/python3','-I',str(self.launcher),'--service','app','--config',str(self.config),
                              '--node-sha256',NODE_HASH,'--command',marker],capture_output=True,text=True,timeout=5)
        self.assertEqual(result.returncode,2);self.assertNotIn(marker,result.stderr);self.assertNotIn(marker,result.stdout)
        self.assertFalse((self.state/'lifetime.lock').exists());self.assertFalse((self.state/'runner.lock').exists())

    def test_actual_jobs_runner_retains_held_journal_without_dispatch(self):
        activate=1791849600000
        journal={'version':1,'activateAt':activate,'jobs':{'program':{'slot':0,'status':'uncertain','finishedAt':1},
                 'cleanup':{'slot':0,'status':'failed'},'sheets':{'slot':0,'status':'partial','sheetWritesUncertain':True}},
                 'sheetWritesBlocked':True,'sheetFailures':[{'slot':0,'status':'uncertain'}],
                 'sheetRecoveryHistory':[{'resolution':'synthetic-retained'}]}
        self.state.joinpath('journal.json').write_text(json.dumps(journal));self.state.joinpath('journal.json').chmod(0o600)
        self.legacy();self.release.joinpath('.next').mkdir();self.release.joinpath('.next/BUILD_ID').write_text('synthetic')
        self.environment.write_text('\n'.join(['PC_APP_RUNTIME=true','NEXT_PUBLIC_PC_APP_RUNTIME=true','PC_BACKEND_ENABLED=true','NEXT_PUBLIC_PC_BACKEND=true',
            'PC_LOCAL_RUNTIME=true','NEXT_PUBLIC_PC_LOCAL_RUNTIME=true','PC_LOCAL_AUTH_URL=http://127.0.0.1:18301','PC_LOCAL_REST_URL=http://127.0.0.1:18302',
            'APP_PUBLIC_ORIGIN=https://fixture.example.test','NEXT_PUBLIC_SUPABASE_URL=https://fixture.example.test/api/pc-supabase','PC_APP_RELEASE_ID=fixture-release',
            'SUPABASE_SERVICE_ROLE_KEY=synthetic-service','NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-anon','CRON_SECRET=synthetic-cron','SHEET_SYNC_SECRET=synthetic-sync',
            'SHEET_SYNC_ENABLED=true','SHEET_SYNC_GAS_URL=https://gas.example.test/synthetic','IMAGE_STORAGE_DRIVER=local','R2_READ_ENABLED=false','R2_WRITE_ENABLED=false',
            'LOCAL_IMAGE_STORAGE_ROOT='+str(self.root/'images'),'LOCAL_IMAGE_SIGNING_KEY='+'a'*64]))
        self.prepare('jobs-run','jobs',runtime='shared-pc',hostStateDirectory=str(self.root/'host-state'),backupStatusPath=str(self.root/'backup-lifecycle.json'),
            expectedBackupInstanceId='11111111-1111-4111-8111-111111111111',expectedBackupDatabaseSystemIdentifier='1234567890123456789',
            expectedBackupDatabaseName='tuat_pc_candidate',releaseCommit='a'*40,releaseId='fixture-release',activateAt='2026-10-13T00:00:00.000Z',
            appOrigin='http://127.0.0.1:18200',port=18200,fixtureJobsModule=str(SOURCE.parent/'pc-jobs/run.mjs'))
        child=self.start('jobs');result=self.line(child);child.communicate(timeout=5)
        self.assertEqual(child.returncode,0);self.assertEqual(result,{'acquired':True,'journal':journal})
        self.assertFalse((self.state/'runner.lock').exists())

if __name__=='__main__':
    unittest.main()
