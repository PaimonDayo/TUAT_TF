import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { loadBackup,validateBackupConfig } from './config.mjs';
import { acquireLock,writePrivate } from './files.mjs';
import { encryptedPair } from './archive.mjs';
import { createAdapters } from './adapters.mjs';
import { STATUS_VERSION,STATUS_FILE,HEARTBEAT_INTERVAL_MS,BACKUP_INTERVAL_MS } from './status.mjs';

export {loadBackup};
export function backupPlan(config) {
  validateBackupConfig(config);
  return {version:1,enabled:config.enabled,starts:false,targetReads:false,providerReads:false,providerWrites:false,
    intervalMinutes:15,backupMaximumAgeMinutes:35,heartbeatMaximumAgeSeconds:120,firstPairEachStartup:true};
}
export async function startBackupSupervisor({configFile,config:providedConfig,env:providedEnv,expectedInstanceId,expectedDatabaseSystemIdentifier,
  adapters:providedAdapters,now=Date.now,setTimer=setInterval,clearTimer=clearInterval,save=writePrivate,lock=acquireLock,
  generation=randomUUID(),report=()=>{},onFatal=()=>{},drainMilliseconds=10_000}={}) {
  if(configFile&&(providedConfig||providedEnv)) throw Error('Ambiguous backup configuration');
  const {config,env}=configFile?loadBackup(configFile):{config:providedConfig,env:providedEnv};
  if(!env) throw Error('Explicit dedicated backup environment required');
  validateBackupConfig(config,env);
  if(!config.enabled) throw Error('Backup lifecycle is disabled');
  if(config.instanceId!==expectedInstanceId||config.target.databaseSystemIdentifier!==expectedDatabaseSystemIdentifier) throw Error('Backup host target mismatch');
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(generation)||!Number.isInteger(drainMilliseconds)||drainMilliseconds<1||drainMilliseconds>10_000) throw Error('Invalid lifecycle identity or drain bound');
  const started=now();
  if(!Number.isFinite(started)) throw Error('Invalid lifecycle clock');
  const identity={instanceId:config.instanceId,generation,startedAt:new Date(started).toISOString()};
  const statusPath=resolve(config.stateDirectory,STATUS_FILE),owner=lock(config.stateDirectory,identity);
  const adapters=providedAdapters??createAdapters(config,env),controller=new AbortController();
  let stopped=false,clock=started,backupBusy=null,probeBusy=null,lastAttempt=null,fatal=false,timer,stopPromise,fatalNotified=false;
  const status={version:STATUS_VERSION,...identity,heartbeat:{checkedAt:identity.startedAt,healthy:true,maintenance:false},
    target:{...config.target,checkedAt:identity.startedAt,healthy:false},backup:null};
  const failed=(type)=>{try {report({event:type});} catch {/* Diagnostics must not change safety state. */}};
  const notifyFatal=reason=>{
    fatal=true;status.heartbeat.healthy=false;controller.abort();
    if(!fatalNotified) {fatalNotified=true;try {Promise.resolve(onFatal({reason})).catch(()=>failed('fatal-owner-callback-failed'));} catch {failed('fatal-owner-callback-failed');}}
  };
  const instant=()=>{const value=now();if(!Number.isFinite(value)||value<clock) {notifyFatal('clock-unverified');throw Error('Lifecycle clock moved backwards');}clock=value;return new Date(value).toISOString();};
  const publish=()=>{try {save(statusPath,status);} catch(error) {notifyFatal('status-publish-unverified');throw error;}};
  const assertActive=()=>{if(stopped||fatalNotified) throw Error('Backup lifecycle stopped');try {owner.assertOwned();} catch(error) {notifyFatal('ownership-unverified');throw error;}instant();};
  const probeTarget=()=>{
    if(probeBusy) return probeBusy;
    probeBusy=Promise.resolve().then(async()=>{
      try {
        assertActive();
        const target=await adapters.probe({signal:controller.signal});
        assertActive();
        for(const key of ['containerId','containerImageId','databaseSystemIdentifier','databaseName','containerName','composeProject','composeService','dataMountSource']) if(target?.[key]!==config.target[key]) throw Error('Probe target mismatch');
        status.target={...config.target,checkedAt:instant(),healthy:true};
        status.heartbeat={checkedAt:instant(),healthy:!fatal,maintenance:false};
        publish();return true;
      } catch {
        status.target.healthy=false;status.heartbeat.healthy=false;
        if(!stopped) {try {status.heartbeat.checkedAt=instant();publish();} catch {fatal=true;}}
        failed('target-or-ownership-unverified');return false;
      }
    }).finally(()=>{probeBusy=null;});
    return probeBusy;
  };
  const backup=()=>{
    if(backupBusy||stopped) return backupBusy;
    backupBusy=Promise.resolve().then(async()=>{
      let stage='target';
      try {
        assertActive();lastAttempt=now();
        if(!await probeTarget()) return;
        stage='dump';const dump=await adapters.dump({signal:controller.signal});assertActive();
        stage='recovery';const recovery=await adapters.recovery({signal:controller.signal});assertActive();
        if(!await probeTarget()) return;
        stage='archive';const stamp=instant().replace(/[:.]/g,'-');
        const pair=encryptedPair({dump,recovery,instanceId:config.instanceId,key:env.PC_BACKUP_ENCRYPTION_KEY,stamp});
        save(resolve(config.stateDirectory,`backup-${stamp}.enc`),pair.bytes,{exclusive:true});
        save(resolve(config.stateDirectory,`recovery-${stamp}.enc`),pair.recoveryBytes,{exclusive:true});
        assertActive();stage='upload';
        const receipt=await adapters.uploadAndVerify(pair,{signal:controller.signal});assertActive();
        if(receipt?.verified!==true) throw Error('Incomplete pair verification');
        stage='target';if(!await probeTarget()) return;
        status.backup={generation,verifiedAt:instant(),key:pair.key,recoveryKey:pair.recoveryKey,sha256:pair.sha256,recoverySha256:pair.recoverySha256,
          bytes:pair.bytes.length,recoveryBytes:pair.recoveryBytes.length,databaseSystemIdentifier:config.target.databaseSystemIdentifier};
        fatal=false;status.heartbeat={checkedAt:instant(),healthy:true,maintenance:false};publish();failed('pair-verified');
      } catch {
        if(stage!=='upload') {fatal=true;status.heartbeat.healthy=false;}
        if(!stopped) {try {status.heartbeat.checkedAt=instant();publish();} catch {fatal=true;}}
        failed(stage==='upload'?'pair-upload-unverified':'pair-not-verified');
      }
    }).finally(()=>{backupBusy=null;});
    return backupBusy;
  };
  const tick=async()=>{
    if(stopped) return;
    try {
      assertActive();
      if(!await probeTarget()) return;
      if(lastAttempt===null||now()-lastAttempt>=BACKUP_INTERVAL_MS) void backup();
    } catch {fatal=true;status.heartbeat.healthy=false;try {publish();} catch {/* Stale status expires; never refresh an uncertain owner. */}failed('lifecycle-unverified');}
  };
  try {publish();timer=setTimer(()=>{void tick();},HEARTBEAT_INTERVAL_MS);void backup();}
  catch(error) {controller.abort();adapters.close?.();owner.release();throw error;}
  return {identity,statusPath,
    stop() {
      if(stopPromise) return stopPromise;
      stopPromise=(async()=>{
      stopped=true;clearTimer(timer);controller.abort();status.heartbeat.healthy=false;status.heartbeat.maintenance=true;
      try {status.heartbeat.checkedAt=instant();publish();} catch {failed('stop-status-unverified');}
      let timeout;
      const finished=await Promise.race([Promise.allSettled([backupBusy,probeBusy]).then(()=>true),new Promise(done=>{timeout=setTimeout(()=>done(false),drainMilliseconds);})]);
      const drained=finished&&adapters.isDrained?.()!==false;
      clearTimeout(timeout);try {adapters.close?.();} catch {failed('stop-adapter-unverified');return {drained:false};}
      if(drained) {try {owner.release();} catch {failed('stop-ownership-unverified');return {drained:false};}}
      else failed('stop-retains-owner-lock');
      return {drained};
      })();
      return stopPromise;
    }
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  // Default/check reads a specified public plan only; does not load environment, connect or create state.
  try {
    const args=process.argv.slice(2),mode=args[0]?.startsWith('--')?args.shift():'--check',file=args.shift();
    if(!file||args.length||!['--check','--execute'].includes(mode)) throw Error('Explicit backup plan required');
    if(mode==='--check') console.log(JSON.stringify(backupPlan(JSON.parse(readFileSync(resolve(file),'utf8')))));
    else {
      const {config}=loadBackup(resolve(file));
      const lifecycle=await startBackupSupervisor({configFile:resolve(file),expectedInstanceId:config.instanceId,expectedDatabaseSystemIdentifier:config.target.databaseSystemIdentifier});
      const stop=async()=>{const result=await lifecycle.stop();process.exitCode=result.drained?0:1;};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
      console.log(JSON.stringify({started:true,identity:lifecycle.identity,statusPath:lifecycle.statusPath}));
    }
  } catch {console.error('Backup lifecycle stopped. Check its private configuration and exact target; no uncertain pair is replayed.');process.exitCode=1;}
}
