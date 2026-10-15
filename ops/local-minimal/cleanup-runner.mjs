// Optional retention after a successful canonical backup publication. The
// producer's existing flock owns this entire direct-child invocation.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {readPrivateFile,verifyPrivatePath} from '../pc-backup/config.mjs';
import {dryRunSnapshotCleanup,applySnapshotCleanup,writeSnapshotCleanupOutcome} from './snapshot-cleanup.mjs';

export const SNAPSHOT_CLEANUP_POLICY='/var/lib/tuat-local/private/snapshot-cleanup-policy.json';
const ROOT='/var/lib/tuat-local/backup';
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>hash(JSON.stringify(value));
const need=(condition)=>{if(!condition)throw Error('Snapshot retention owner or scope unavailable');};
const iso=value=>new Date(Date.parse(value)).toISOString();
const fields=['sourceId','databaseSystemIdentifier','storageScopeId','archiveKeyId'];

/** Linux dev_t decomposition, and exact whole-file FLOCK ownership. A blocked
 * waiter, a POSIX lock or another inode never establishes the writer boundary. */
export function producerFlockProof(raw,{pid,dev,ino}) {
  const device=BigInt(dev),major=((device>>8n)&0xfffn)|((device>>32n)&0xfffff000n),minor=(device&0xffn)|((device>>12n)&0xffffff00n);
  const matches=raw.split('\n').map(line=>line.trim().split(/\s+/)).filter(parts=>{
    if(parts.length!==8||parts[1]!=='FLOCK'||parts[2]!=='ADVISORY'||parts[3]!=='WRITE'||parts[4]!==String(pid)||parts[6]!=='0'||parts[7]!=='EOF')return false;
    const key=parts[5].match(/^([a-f0-9]+):([a-f0-9]+):(\d+)$/i);
    return key&&BigInt(`0x${key[1]}`)===major&&BigInt(`0x${key[2]}`)===minor&&BigInt(key[3])===BigInt(ino);
  });
  need(matches.length===1);return {pid,dev:String(dev),ino:String(ino)};
}

export function snapshotProducerOwner(config,{read=readPrivateFile,readProc=readFileSync,parentPid=process.ppid,
  privateStat=path=>{verifyPrivatePath(path,4096);return lstatSync(path,{bigint:true});}}={}) {
  need(Number.isSafeInteger(parentPid)&&parentPid>1);
  const proc=name=>readProc(`/proc/${parentPid}/${name}`).toString('utf8');
  const argv=proc('cmdline').split('\0');if(argv.at(-1)==='')argv.pop();
  need(argv.length===6&&argv[0]==='/usr/bin/python3'&&argv[1]==='-I'&&argv[2]===fileURLToPath(new URL('./backup.py',import.meta.url))
    &&argv[3]==='--config'&&argv[5]==='--execute'&&posix.isAbsolute(argv[4])&&posix.normalize(argv[4])===argv[4]);
  const parentConfig=JSON.parse(read(argv[4],128*1024)),attempt=JSON.parse(read(`${ROOT}/periodic-attempt.json`,128*1024));
  need(parentConfig.version===1&&parentConfig.profile==='pc-private'&&parentConfig.periodic?.enabled===true&&parentConfig.sourceId===config.sourceId
    &&parentConfig.backupRoot===ROOT&&parentConfig.receiptFile===config.producerReceiptFile&&parentConfig.imageRoot===config.imageRoot
    &&typeof parentConfig.recoveryKeyCopy==='string');
  const stat=proc('stat'),end=stat.lastIndexOf(')'),rest=stat.slice(end+1).trim().split(/\s+/),birth=Number(rest[19]);
  need(end>0&&Number(stat.slice(0,stat.indexOf(' ')))===parentPid&&Number.isSafeInteger(birth)&&birth>0&&rest[0]!=='Z');
  const uid=proc('status').match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m);
  need(uid&&uid.slice(1).every(value=>value==='0'));
  const owner=attempt.identity,boot=readProc('/proc/sys/kernel/random/boot_id').toString('utf8').trim();
  const environment=proc('environ').split('\0'),cgroup=proc('cgroup').trim();
  need(attempt.version===1&&attempt.sourceId===config.sourceId&&attempt.phase==='offsite-started'&&owner?.pid===parentPid
    &&owner.birthTicks===birth&&owner.bootId===boot&&/^[a-f0-9]{32}$/.test(owner.invocationId??'')
    &&environment.filter(value=>value.startsWith('INVOCATION_ID=')).join()===`INVOCATION_ID=${owner.invocationId}`
    &&cgroup===`0::${owner.controlGroup}`&&owner.controlGroup.endsWith('/tuat-local-backup.service')
    &&owner.sourceId===config.sourceId&&owner.configSha256===hash(read(argv[4],128*1024)));
  const lock=privateStat(`${ROOT}/backup.lock`);
  need(lock.isFile()&&!lock.isSymbolicLink()&&lock.nlink===1n&&lock.uid===0n&&(lock.mode&0o077n)===0n);
  const flock=producerFlockProof(readProc('/proc/locks').toString('utf8'),{pid:parentPid,dev:lock.dev,ino:lock.ino});
  const receiptBytes=read(config.producerReceiptFile,16384),receipt=JSON.parse(receiptBytes);
  need(attempt.receiptHash===hash(receiptBytes)&&receipt.sourceId===config.sourceId&&receipt.databaseSystemIdentifier===config.databaseSystemIdentifier
    &&receipt.imageRoot===config.imageRoot&&receipt.independentRecoveryCopyChecked===true);
  return {ownerToken:digest({owner,flock}),parentConfig,receipt,receiptDigest:hash(receiptBytes)};
}

/** No policy is an opt-out. Retention failures never uncommit a verified backup
 * or change its strict three-field ACK. The private outcome is separate. */
export async function runSnapshotCleanup(config,{client,now=Date.now,read=readPrivateFile,owner=snapshotProducerOwner,
  dryRun=dryRunSnapshotCleanup,apply=applySnapshotCleanup,writeOutcome=writeSnapshotCleanupOutcome,onHeld=()=>{}}={}) {
  if(config.profile!=='pc-private')return {state:'disabled'};
  let policy,policyBytes;
  try{policyBytes=read(SNAPSHOT_CLEANUP_POLICY,16384);policy=JSON.parse(policyBytes);}catch(error){if(error?.code==='ENOENT')return {state:'disabled'};policy=null;}
  if(policy?.version===1&&policy.enabled===false)return {state:'disabled'};
  let outcome;
  try {
    need(policy?.version===1&&policy.enabled===true&&['dry-run','apply',undefined].includes(policy.mode)&&policy.immutableSourceNamespace===true
      &&Object.keys(policy).every(key=>['version','enabled','mode','immutableSourceNamespace',...fields].includes(key)));
    const environment=parseEnv(read(config.environmentFile,16384).toString('utf8'));
    const scope={sourceId:config.sourceId,databaseSystemIdentifier:config.databaseSystemIdentifier,
      storageScopeId:digest({account:environment.R2_ACCOUNT_ID,bucket:config.bucket}),archiveKeyId:hash(Buffer.from(environment.PC_BACKUP_ENCRYPTION_KEY??'','hex'))};
    need(fields.every(key=>policy[key]===scope[key]));
    const initial=owner(config,{read});
    const assertOwner=()=>{need(read(SNAPSHOT_CLEANUP_POLICY,16384).equals(policyBytes));const current=owner(config,{read});
      need(current.ownerToken===initial.ownerToken&&current.receiptDigest===initial.receiptDigest);return current;};
    const options={client,now,read,conditionalDeleteSupported:false,immutableSourceNamespace:true,maxOperations:8,
      async assertExclusiveLifecycleWriter({identity,prefix}){const current=assertOwner();return {exclusive:true,...scope,generation:identity.generation,prefix,ownerToken:current.ownerToken};},
      async verifyRetainedRecovery({snapshot,identity}) {
        const current=assertOwner(),receipt=current.receipt,producer=current.parentConfig;
        const runtime=read(producer.runtimeKey,32),recovery=read(producer.recoveryKeyCopy,32);
        need(runtime.length===32&&runtime.equals(recovery)&&hash(runtime)===identity.archiveKeyId&&receipt.recoveryKeyFingerprint===identity.archiveKeyId
          &&receipt.archiveSha256===snapshot.archiveSha256&&iso(receipt.verifiedAt)===snapshot.capturedAt&&iso(receipt.restoreVerifiedAt)===snapshot.restoreVerifiedAt);
        return {verified:true,...scope,generation:identity.generation,archiveKey:snapshot.archiveKey,archiveSha256:snapshot.archiveSha256,checkedAt:new Date(now()).toISOString()};
      }};
    const preview=await dryRun(config,options);
    const counts={local:preview.plan.local.removalCandidates.length,remote:preview.plan.remote.removalCandidates.length,metadata:preview.metadataCandidates.length};
    const result=policy.mode==='apply'?await apply(config,preview,options):null;
    outcome={version:1,state:result?'applied':'dry-run',checkedAt:new Date(now()).toISOString(),previewDigest:preview.previewDigest,counts,
      ...(result?{completed:result.completed,remaining:result.remaining}:{}),reasonCode:result?'known-results':'review-only'};
  } catch {
    outcome={version:1,state:'held',checkedAt:new Date(now()).toISOString(),reasonCode:'retention-proof-unavailable'};onHeld();
  }
  try{await writeOutcome(config,outcome);}catch{onHeld();}
  return outcome;
}
