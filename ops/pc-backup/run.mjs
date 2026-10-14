import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { loadBackup,validateBackupConfig,readPrivateFile,BACKUP_LIMITS,backupTargetFields,backupTargetFingerprint } from './config.mjs';
import { acquireLock,writePrivate,readBackupInventory } from './files.mjs';
import { encryptedPair,sha256 } from './archive.mjs';
import { createAdapters,createCycleBudget,inventoryBounds,STORAGE_LIMITS } from './adapters.mjs';
import { classifyBackupReceipts,reconcileBackupInventory,planBackupAdmission,planBackupRetention } from './retention.mjs';
import { STATUS_VERSION,STATUS_FILE,HEARTBEAT_INTERVAL_MS,BACKUP_INTERVAL_MS,localSnapshotReady } from './status.mjs';
import { writeApplicationStatus } from './application-status.mjs';

export {loadBackup};
export function backupPlan(config) {
  validateBackupConfig(config);
  return {version:1,enabled:config.enabled,starts:false,targetReads:false,providerReads:false,providerWrites:false,
    intervalMinutes:15,backupMaximumAgeMinutes:35,heartbeatMaximumAgeSeconds:120,firstPairEachStartup:!config.localSnapshotReceiptFile,
    combinedLocalSnapshot:!!config.localSnapshotReceiptFile};
}
export async function startBackupSupervisor({configFile,config:providedConfig,env:providedEnv,expectedInstanceId,expectedDatabaseSystemIdentifier,expectedDatabaseName='postgres',
  adapters:providedAdapters,readInventory=readBackupInventory,now=Date.now,setTimer=setInterval,clearTimer=clearInterval,save=writePrivate,lock=acquireLock,
  generation=randomUUID(),report=()=>{},onFatal=()=>{},drainMilliseconds=10_000,readSnapshot=path=>JSON.parse(readPrivateFile(path,16384).toString('utf8'))}={}) {
  if(configFile&&(providedConfig||providedEnv)) throw Error('Ambiguous backup configuration');
  const {config,env}=configFile?loadBackup(configFile):{config:providedConfig,env:providedEnv};
  if(!env) throw Error('Explicit dedicated backup environment required');
  validateBackupConfig(config,env);
  if(!config.enabled) throw Error('Backup lifecycle is disabled');
  if(config.instanceId!==expectedInstanceId||config.target.databaseSystemIdentifier!==expectedDatabaseSystemIdentifier||config.target.databaseName!==expectedDatabaseName) throw Error('Backup host target mismatch');
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(generation)||!Number.isInteger(drainMilliseconds)||drainMilliseconds<1||drainMilliseconds>10_000) throw Error('Invalid lifecycle identity or drain bound');
  const started=now();
  if(!Number.isFinite(started)) throw Error('Invalid lifecycle clock');
  const identity={instanceId:config.instanceId,generation,startedAt:new Date(started).toISOString()};
  const privateStatusPath=resolve(config.stateDirectory,STATUS_FILE),
    statusPath=resolve(config.applicationStatusDirectory??config.stateDirectory,STATUS_FILE),owner=lock(config.stateDirectory,identity);
  const adapters=providedAdapters??createAdapters(config,env),controller=new AbortController();
  let stopped=false,clock=started,backupBusy=null,probeBusy=null,lastAttempt=null,fatal=false,timer,stopPromise,fatalNotified=false;
  const status={version:STATUS_VERSION,...identity,heartbeat:{checkedAt:identity.startedAt,healthy:true,maintenance:false},
    target:{...config.target,checkedAt:identity.startedAt,healthy:false},backup:null};
  const scope={
    targetFingerprint:backupTargetFingerprint(config),
    storageScopeId:sha256(JSON.stringify({account:env.R2_ACCOUNT_ID,bucket:env.R2_BUCKET_NAME})),
    archiveKeyId:sha256(Buffer.from(env.PC_BACKUP_ENCRYPTION_KEY,'hex')),
  };
  const expected={...identity,databaseSystemIdentifier:config.target.databaseSystemIdentifier};
  const prefix=`ops/pc-backend/${config.instanceId}/backups/`,capacity=config.capacity;
  const inventory=async(budget)=>{
    assertActive();const local=readInventory({stateDirectory:config.stateDirectory,inventoryLimit:capacity.inventoryLimit,maxPairBytes:capacity.maxPairBytes,signal:controller.signal});
    const classified=classifyBackupReceipts({receipts:local.receipts,identity:expected,scope,now:now(),inventoryLimit:capacity.inventoryLimit});
    const snapshot=await adapters.listInventory({prefix,inventoryLimit:capacity.inventoryLimit,budget,signal:controller.signal});assertActive();
    return {local,classified,snapshot};
  };
  const reverify=async(discovered,budget)=>{
    const remote=await adapters.verifyInventory({snapshot:discovered.snapshot,receipts:discovered.classified.verifiedReceipts.filter(receipt=>receipt.remoteState==='verified'),budget,signal:controller.signal});assertActive();
    return reconcileBackupInventory({classified:discovered.classified,local:discovered.local,remote,inventoryLimit:capacity.inventoryLimit,maxPairBytes:capacity.maxPairBytes});
  };
  const planInput=(checked,budget,nextPairBytes=capacity.maxPairBytes)=>({identity:expected,scope,receipts:checked.receipts,
    inventoryLimit:capacity.inventoryLimit,planNonce:randomUUID(),now:now(),budgets:{maxLocalBytes:capacity.maxLocalBytes,maxRemoteBytes:capacity.maxRemoteBytes,
      freeLocalBytes:checked.freeLocalBytes,minFreeLocalBytes:capacity.minFreeLocalBytes,remoteBaselineBytes:0,nextPairBytes,
      nextLocalBytes:nextPairBytes+BACKUP_LIMITS.metadataBytes,maxRequestCount:capacity.maxRequestCount,maxTransferBytes:capacity.maxTransferBytes,...budget}});
  const failed=(type)=>{try {report({event:type});} catch {/* Diagnostics must not change safety state. */}};
  const notifyFatal=reason=>{
    fatal=true;status.heartbeat.healthy=false;controller.abort();
    if(!fatalNotified) {fatalNotified=true;try {Promise.resolve(onFatal({reason})).catch(()=>failed('fatal-owner-callback-failed'));} catch {failed('fatal-owner-callback-failed');}}
  };
  const instant=()=>{const value=now();if(!Number.isFinite(value)||value<clock) {notifyFatal('clock-unverified');throw Error('Lifecycle clock moved backwards');}clock=value;return new Date(value).toISOString();};
  const publish=()=>{try {
    if(config.localSnapshotReceiptFile) {
      let snapshot;
      try {snapshot=readSnapshot(config.localSnapshotReceiptFile);}catch{}
      if(localSnapshotReady({backup:{localSnapshot:snapshot}},expected,config.localImageRoot,now())) {
        status.backup={generation,verifiedAt:snapshot.offsiteVerifiedAt,key:snapshot.archiveKey,sha256:snapshot.archiveSha256,bytes:snapshot.archiveBytes,
          databaseSystemIdentifier:config.target.databaseSystemIdentifier,localSnapshot:snapshot};
      } else status.backup=null;
    }
    save(privateStatusPath,status);
    if(config.applicationStatusDirectory)writeApplicationStatus(config,status);
  } catch(error) {notifyFatal('status-publish-unverified');throw error;}};
  const assertActive=()=>{if(stopped||fatalNotified) throw Error('Backup lifecycle stopped');try {owner.assertOwned();} catch(error) {notifyFatal('ownership-unverified');throw error;}instant();};
  const probeTarget=()=>{
    if(probeBusy) return probeBusy;
    probeBusy=Promise.resolve().then(async()=>{
      try {
        assertActive();
        const target=await adapters.probe({signal:controller.signal});
        assertActive();
        for(const key of backupTargetFields(config)) if(target?.[key]!==config.target[key]) throw Error('Probe target mismatch');
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
        // The local producer/offsite CLI owns the single combined archive. This
        // owner only checks DB identity/heartbeat and consumes its private receipt.
        if(config.localSnapshotReceiptFile) {publish();return;}
        stage='inventory';
        const budget=createCycleBudget(capacity),discovered=await inventory(budget);
        const bounds=inventoryBounds({inventoryLimit:capacity.inventoryLimit,receipts:discovered.classified.verifiedReceipts.filter(receipt=>receipt.remoteState==='verified'),maxPairBytes:capacity.maxPairBytes});
        // Entire cycle allowance is checked before any ciphertext GET or dump/PUT.
        if(bounds.requestCount>capacity.maxRequestCount||bounds.transferBytes>capacity.maxTransferBytes)throw Error('Cycle read budget insufficient');
        budget.reserve(6,2*capacity.maxPairBytes+6*STORAGE_LIMITS.controlResponseBytes); // Prepaid new pair; never retried.
        const checked=await reverify(discovered,budget);
        stage='capacity';const admission=planBackupAdmission(planInput(checked,bounds));
        if(!admission.decision.writeAllowed)throw Error('Capacity admission refused');
        stage='attempt';const capturedAt=instant(),stamp=capturedAt.replace(/[:.]/g,'-'),receiptId=randomUUID();
        const dumpKey=`ops/pc-backend/${config.instanceId}/backups/${stamp}.dump.enc`;
        const attemptPath=resolve(config.stateDirectory,'receipts',`${receiptId}.json`);
        let attempt={version:1,state:'prepared',receiptId,...identity,databaseSystemIdentifier:config.target.databaseSystemIdentifier,...scope,
          capturedAt,dumpKey,recoveryKey:dumpKey.replace('.dump.enc','.recovery.json.enc'),localState:'unknown',remoteState:'unknown',
          localBytes:capacity.maxPairBytes,remoteBytes:capacity.maxPairBytes};
        // Persist intent before dump/archive/PUT. Incomplete or uncertain attempts
        // remain held; this is evidence for planning, never permission to delete.
        save(attemptPath,attempt,{exclusive:true});assertActive();
        stage='dump';const dump=await adapters.dump({signal:controller.signal});assertActive();
        stage='recovery';const recovery=await adapters.recovery({signal:controller.signal});assertActive();
        if(!await probeTarget()) return;
        stage='archive';
        if(!Buffer.isBuffer(dump)||dump.length>BACKUP_LIMITS.dumpBytes
          ||Buffer.byteLength(JSON.stringify({...recovery,instanceId:config.instanceId,databaseDumpSha256:sha256(dump)}))>BACKUP_LIMITS.recoveryBytes)
          throw Error('Backup plaintext exceeds adapter bound');
        const pair=encryptedPair({dump,recovery,instanceId:config.instanceId,key:env.PC_BACKUP_ENCRYPTION_KEY,stamp});
        if(pair.key!==attempt.dumpKey||pair.recoveryKey!==attempt.recoveryKey) throw Error('Backup pair identity changed');
        const pairBytes=pair.bytes.length+pair.recoveryBytes.length;
        if(!Number.isSafeInteger(pairBytes)||pairBytes>capacity.maxPairBytes) throw Error('Backup size exceeds reservation');
        attempt={...attempt,dumpSha256:pair.sha256,recoverySha256:pair.recoverySha256,dumpBytes:pair.bytes.length,recoveryBytes:pair.recoveryBytes.length,
          localBytes:pairBytes,remoteBytes:pairBytes};
        // Reserve the whole pair conservatively even if a local write or one PUT fails.
        save(attemptPath,attempt);assertActive();
        save(resolve(config.stateDirectory,`backup-${stamp}.enc`),pair.bytes,{exclusive:true});
        save(resolve(config.stateDirectory,`recovery-${stamp}.enc`),pair.recoveryBytes,{exclusive:true});
        attempt={...attempt,localState:'complete'};save(attemptPath,attempt);
        assertActive();stage='upload';
        const receipt=await adapters.uploadAndVerify(pair,{signal:controller.signal});assertActive();
        if(receipt?.verified!==true||![receipt.dumpEtag,receipt.recoveryEtag].every(value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\r\n\0]/.test(value))) throw Error('Incomplete pair verification');
        stage='target';if(!await probeTarget()) return;
        stage='receipt';const verifiedAt=instant();
        const verifiedReceipt={...attempt,state:'verified',verifiedAt,dumpEtag:receipt.dumpEtag,recoveryEtag:receipt.recoveryEtag,remoteState:'verified'};
        save(attemptPath,verifiedReceipt);
        assertActive();
        stage='inventory';const finalInventory=await reverify(await inventory(budget),budget);
        stage='target';if(!await probeTarget()) return;
        stage='inventory';
        const manifest=planBackupRetention({...planInput(finalInventory,budget.snapshot()),protectedPair:verifiedReceipt});
        if(!manifest.decision.planningAllowed||manifest.quota.decision==='unverified')throw Error('Verified inventory unavailable');
        stage='capacity';
        if(manifest.quota.current.localBytes>capacity.maxLocalBytes||manifest.quota.current.remoteBytes>capacity.maxRemoteBytes
          ||finalInventory.freeLocalBytes-capacity.minFreeLocalBytes<BACKUP_LIMITS.metadataBytes)throw Error('Final capacity unavailable');
        const envelope={...manifest,inventoryProofDigest:finalInventory.proofDigest,scopeDescription:{local:'entire dedicated state directory',remote:prefix},cycleBudget:budget.snapshot()};
        const persistedManifest={...envelope,manifestDigest:sha256(JSON.stringify(envelope))};
        const manifestBytes=Buffer.byteLength(JSON.stringify(persistedManifest,null,2)+'\n');
        if(manifestBytes>BACKUP_LIMITS.metadataBytes)throw Error('Dry-run manifest exceeds metadata reservation');
        // Include the exact new temp/manifest even when the prior manifest is still present.
        if(manifest.quota.current.localBytes>capacity.maxLocalBytes-manifestBytes)throw Error('Manifest capacity unavailable');
        stage='manifest';save(resolve(config.stateDirectory,'retention-dry-run.json'),persistedManifest);assertActive();
        status.backup={generation,verifiedAt,key:pair.key,recoveryKey:pair.recoveryKey,sha256:pair.sha256,recoverySha256:pair.recoverySha256,
          bytes:pair.bytes.length,recoveryBytes:pair.recoveryBytes.length,databaseSystemIdentifier:config.target.databaseSystemIdentifier};
        fatal=false;status.heartbeat={checkedAt:instant(),healthy:true,maintenance:false};publish();failed('pair-verified');
      } catch {
        if(!['upload','capacity'].includes(stage)) {fatal=true;status.heartbeat.healthy=false;}
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
  return {identity,statusPath,databaseName:config.target.databaseName,
    stop() {
      if(stopPromise) return stopPromise;
      stopPromise=(async()=>{
      stopped=true;clearTimer(timer);status.heartbeat.healthy=false;status.heartbeat.maintenance=true;
      // Combined mode only observes source identity. Let its bounded read finish
      // before aborting, so an ordinary stop does not manufacture an uncertain
      // Docker command. Backup writers still abort immediately.
      if(!config.localSnapshotReceiptFile)controller.abort();
      try {status.heartbeat.checkedAt=instant();publish();} catch {failed('stop-status-unverified');}
      let timeout;
      const finished=await Promise.race([Promise.allSettled([backupBusy,probeBusy]).then(()=>true),new Promise(done=>{timeout=setTimeout(()=>done(false),drainMilliseconds);})]);
      const drained=finished&&adapters.isDrained?.()!==false;
      controller.abort();
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
      const lifecycle=await startBackupSupervisor({configFile:resolve(file),expectedInstanceId:config.instanceId,expectedDatabaseSystemIdentifier:config.target.databaseSystemIdentifier,expectedDatabaseName:config.target.databaseName});
      const stop=async()=>{const result=await lifecycle.stop();process.exitCode=result.drained?0:1;};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
      console.log(JSON.stringify({started:true,identity:lifecycle.identity,statusPath:lifecycle.statusPath}));
    }
  } catch {console.error('Backup lifecycle stopped. Check its private configuration and exact target; no uncertain pair is replayed.');process.exitCode=1;}
}
