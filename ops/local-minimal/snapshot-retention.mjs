// Pure selection of independently verified combined snapshots. Never performs I/O.
import {createHash} from 'node:crypto';
import {RETENTION_POLICY,MAX_RETENTION_INVENTORY} from '../pc-backup/retention.mjs';

const DAY=86_400_000,JST=9*60*60_000,FRESH=35*60_000;
const fields=['version','state','storageScopeId','archiveKeyId','objectEtag','localArchiveFile','format','sourceId','generation',
  'databaseSystemIdentifier','imageRoot','archiveKey','archiveSha256','archiveBytes','capturedAt',
  'restoreVerifiedAt','offsiteVerifiedAt','independentRecoveryCopyChecked'];
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const utc=value=>{const time=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(time)&&new Date(time).toISOString()===value?time:NaN;};
function flat(value,allowed) {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)return null;
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Object.keys(descriptors);
  if(keys.length!==allowed.length||keys.some(key=>!allowed.includes(key)))return null;
  const result={};
  for(const key of allowed){const d=descriptors[key];if(!d||!Object.hasOwn(d,'value')||d.value!==null&&!['string','number','boolean'].includes(typeof d.value)||typeof d.value==='string'&&d.value.length>4096)return null;result[key]=d.value;}
  return result;
}
const refusal=reason=>({version:1,dryRun:true,planningAllowed:false,deletionAuthorized:false,reason,
  local:{keep:[],removalCandidates:[]},remote:{keep:[],removalCandidates:[]}});
function valid(record,identity,now) {
  if(!record||record.version!==1||record.state!=='verified'||record.format!=='tuat-local-db-images-v1'||record.independentRecoveryCopyChecked!==true
    ||record.sourceId!==identity.sourceId||record.storageScopeId!==identity.storageScopeId||record.archiveKeyId!==identity.archiveKeyId||record.databaseSystemIdentifier!==identity.databaseSystemIdentifier
    ||!uuid(record.generation)||record.imageRoot!=='/var/lib/tuat-local/images'||!hash(record.archiveSha256)
    ||!Number.isSafeInteger(record.archiveBytes)||record.archiveBytes<36||record.archiveBytes>16*1024**3
    ||typeof record.objectEtag!=='string'||!record.objectEtag||record.objectEtag.length>256||/[\r\n\0]/.test(record.objectEtag)
    ||!/^\/var\/lib\/tuat-local\/backup\/snapshot-[a-f0-9]{16}\.tar\.enc$/.test(record.localArchiveFile))return false;
  const captured=utc(record.capturedAt),restored=utc(record.restoreVerifiedAt),verified=utc(record.offsiteVerifiedAt);
  return [captured,restored,verified].every(Number.isFinite)&&captured<=restored&&restored<=verified&&verified<=now
    &&record.archiveKey===`ops/pc-backend/${identity.sourceId}/backups/${record.capturedAt.replace(/[:.]/g,'-')}.local.tar.enc`;
}
function select(records,count,protectedKey,now) {
  const keep=new Set(records.slice(0,Math.max(count,RETENTION_POLICY.latestFallback)).map(r=>r.archiveKey));
  keep.add(protectedKey);const today=Math.floor((now+JST)/DAY),days=new Set();
  for(const r of records){const day=Math.floor((utc(r.capturedAt)+JST)/DAY);if(day>=today-RETENTION_POLICY.jstCalendarDays+1&&day<=today&&!days.has(day)){keep.add(r.archiveKey);days.add(day);}}
  return keep;
}
const reference=record=>({archiveKey:record.archiveKey,objectEtag:record.objectEtag,archiveSha256:record.archiveSha256,
  archiveBytes:record.archiveBytes,localArchiveFile:record.localArchiveFile,capturedAt:record.capturedAt,receiptDigest:digest(record)});

/** Metadata dry run only. The caller must separately discover complete actual
 * inventory, verify ciphertext/retained recovery, and bind a fresh deletion scope.
 * Unknown files, unmatched objects and PUT intents are never eligible receipts.
 */
export function verifiedSnapshotReceipt(raw,identity,now) {
  const record=flat(raw,fields);
  return valid(record,identity,now)?record:null;
}

export function planSnapshotRetention({identity:rawIdentity,snapshots,protectedSnapshot:rawProtected,planNonce,now,availability}={}) {
  const identity=flat(rawIdentity,['sourceId','storageScopeId','archiveKeyId','databaseSystemIdentifier','generation','startedAt']);
  if(!identity||!uuid(identity.sourceId)||!uuid(identity.generation)||!hash(identity.storageScopeId)||!hash(identity.archiveKeyId)
    ||!/^\d{10,20}$/.test(identity.databaseSystemIdentifier??'')||!Number.isFinite(utc(identity.startedAt))
    ||!uuid(planNonce)||!Number.isSafeInteger(now)||now<0||!Number.isFinite(new Date(now).getTime())||utc(identity.startedAt)>now)return refusal('identity_unverified');
  if(!Array.isArray(snapshots)||snapshots.length<1||snapshots.length>MAX_RETENTION_INVENTORY)return refusal('inventory_unverified');
  const slots=Object.getOwnPropertyDescriptors(snapshots);
  const records=Array.from({length:snapshots.length},(_,i)=>Object.hasOwn(slots[i]??{},'value')?flat(slots[i].value,fields):null);
  if(records.some(record=>!valid(record,identity,now)))return refusal('receipt_unverified');
  if(new Set(records.map(r=>r.archiveKey)).size!==records.length||new Set(records.map(r=>r.localArchiveFile)).size!==records.length)return refusal('duplicate_identity');
  const protectedSnapshot=flat(rawProtected,fields);
  if(!valid(protectedSnapshot,identity,now)||protectedSnapshot.generation!==identity.generation
    ||utc(protectedSnapshot.capturedAt)<utc(identity.startedAt)||now-utc(protectedSnapshot.capturedAt)>=FRESH)return refusal('protected_snapshot_unverified');
  if(records.filter(r=>r.archiveKey===protectedSnapshot.archiveKey&&digest(r)===digest(protectedSnapshot)).length!==1)return refusal('protected_snapshot_missing_or_changed');
  records.sort((a,b)=>utc(b.capturedAt)-utc(a.capturedAt));
  const available={local:records,remote:records};
  if(availability!==undefined) {
    if(!availability||typeof availability!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(availability))
      ||Object.getOwnPropertySymbols(availability).length||Object.keys(availability).sort().join(',')!=='local,remote')return refusal('availability_unverified');
    const locations=Object.getOwnPropertyDescriptors(availability);
    const known=new Set(records.map(r=>r.archiveKey));
    for(const location of ['local','remote']) {
      if(!Object.hasOwn(locations[location]??{},'value'))return refusal('availability_unverified');
      const rawKeys=locations[location].value;
      if(!Array.isArray(rawKeys)||rawKeys.length>records.length||Object.getOwnPropertySymbols(rawKeys).length)return refusal('availability_unverified');
      const slots=Object.getOwnPropertyDescriptors(rawKeys),keys=[];
      for(let i=0;i<rawKeys.length;i++){if(!Object.hasOwn(slots[i]??{},'value')||typeof slots[i].value!=='string')return refusal('availability_unverified');keys.push(slots[i].value);}
      if(Object.keys(rawKeys).length!==keys.length||keys.some(key=>!known.has(key))||new Set(keys).size!==keys.length
        ||!keys.includes(protectedSnapshot.archiveKey))return refusal('availability_unverified');
      const set=new Set(keys);available[location]=records.filter(r=>set.has(r.archiveKey));
    }
  }
  const local=select(available.local,RETENTION_POLICY.localLatest,protectedSnapshot.archiveKey,now),remote=select(available.remote,RETENTION_POLICY.remoteLatest,protectedSnapshot.archiveKey,now);
  const result={version:1,dryRun:true,planningAllowed:true,deletionAuthorized:false,
    binding:{...identity,planNonce,plannedAt:new Date(now).toISOString()},inventoryDigest:digest(records),
    local:{keep:available.local.filter(r=>local.has(r.archiveKey)).map(reference),removalCandidates:available.local.filter(r=>!local.has(r.archiveKey)).map(reference)},
    remote:{keep:available.remote.filter(r=>remote.has(r.archiveKey)).map(reference),removalCandidates:available.remote.filter(r=>!remote.has(r.archiveKey)).map(reference)}};
  return {...result,planDigest:digest(result)};
}
