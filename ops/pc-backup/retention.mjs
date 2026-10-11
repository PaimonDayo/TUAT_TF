// Pure dry-run decision only. Supervisor receipts are produced separately;
// no inventory discovery, capacity reservation or deletion transport is integrated.
import { createHash } from 'node:crypto';

const DAY=86_400_000,JST=9*60*60_000,FRESH_PAIR=35*60_000;
export const RETENTION_POLICY=Object.freeze({localLatest:24,remoteLatest:96,jstCalendarDays:30,latestFallback:2});
export const MAX_RETENTION_INVENTORY=4096;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const bytes=value=>Number.isSafeInteger(value)&&value>=0;
const utc=value=>{
  if(typeof value!=='string') return NaN;
  const time=Date.parse(value);
  return Number.isFinite(time)&&new Date(time).toISOString()===value?time:NaN;
};
const etag=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\r\n\0]/.test(value);
const receiptFields=['version','state','receiptId','instanceId','generation','startedAt','databaseSystemIdentifier','targetFingerprint',
  'storageScopeId','archiveKeyId','capturedAt','verifiedAt','dumpKey','recoveryKey','dumpSha256','recoverySha256','dumpEtag','recoveryEtag',
  'dumpBytes','recoveryBytes','localState','remoteState','localBytes','remoteBytes'];
const identityFields=['instanceId','generation','startedAt','databaseSystemIdentifier'];
const scopeFields=['targetFingerprint','storageScopeId','archiveKeyId'];
const budgetFields=['maxLocalBytes','maxRemoteBytes','freeLocalBytes','minFreeLocalBytes','remoteBaselineBytes','nextPairBytes','maxRequestCount','maxTransferBytes'];

// The API accepts bounded, flat JSON metadata. Accessors, nested payloads and extra receipt fields are held;
// no user callback or toJSON is invoked while examining an untrusted record.
function metadata(value,fields) {
  if(value===null||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))) return null;
  if(Object.getOwnPropertySymbols(value).length)return null;
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Object.keys(descriptors).sort();
  if(keys.length>fields.length||keys.some(key=>!fields.includes(key))) return null;
  const result={};
  for(const key of keys) {
    const field=descriptors[key];
    if(!Object.hasOwn(field,'value')) return null;
    const item=field.value;
    if(item!==null&&!['string','number','boolean'].includes(typeof item)) return null;
    if(typeof item==='string'&&item.length>2048) return null;
    if(typeof item==='number'&&!Number.isFinite(item)) return null;
    result[key]=item;
  }
  return result;
}
function add(a,b) {const sum=a+b;if(!Number.isSafeInteger(sum))throw Error('numeric_overflow');return sum;}
function fail(reason,heldCount=0,binding=null,inventoryDigest=null) {
  return {version:1,dryRun:true,decision:{planningAllowed:false,writeAllowed:false,reason},binding,inventoryDigest,planDigest:null,
    retained:{local:[],remote:[]},removalCandidates:{local:[],remote:[]},held:{count:heldCount,unknownSizeCount:heldCount},
    quota:{decision:'unverified'}};
}
function verified(record) {
  if(!record||record.version!==1||record.state!=='verified'||!uuid(record.receiptId)||!uuid(record.instanceId)||!uuid(record.generation)
    ||!/^[0-9]{10,20}$/.test(record.databaseSystemIdentifier??'')||!scopeFields.every(field=>hash(record[field]))) return false;
  const started=utc(record.startedAt),captured=utc(record.capturedAt),confirmed=utc(record.verifiedAt);
  if(![started,captured,confirmed].every(Number.isFinite)||captured<started||confirmed<captured) return false;
  const key=`ops/pc-backend/${record.instanceId}/backups/${record.capturedAt.replace(/[:.]/g,'-')}.dump.enc`;
  if(record.dumpKey!==key||record.recoveryKey!==key.replace('.dump.enc','.recovery.json.enc')
    ||!hash(record.dumpSha256)||!hash(record.recoverySha256)||!etag(record.dumpEtag)||!etag(record.recoveryEtag)
    ||!bytes(record.dumpBytes)||record.dumpBytes<36||!bytes(record.recoveryBytes)||record.recoveryBytes<36
    ||!['complete','absent'].includes(record.localState)||!['verified','absent'].includes(record.remoteState)) return false;
  const pairBytes=add(record.dumpBytes,record.recoveryBytes);
  return record.localBytes===(record.localState==='complete'?pairBytes:0)
    &&record.remoteBytes===(record.remoteState==='verified'?pairBytes:0)
    &&!(record.localState==='absent'&&record.remoteState==='absent');
}
function keepIds(records,latest,current,now) {
  const keep=new Set(records.slice(0,Math.max(latest,RETENTION_POLICY.latestFallback)).map(record=>record.receiptId));
  if(records.some(record=>record.receiptId===current))keep.add(current);
  const days=new Set(),today=Math.floor((now+JST)/DAY);
  for(const record of records) {
    const day=Math.floor((utc(record.capturedAt)+JST)/DAY);
    if(day>=today-RETENTION_POLICY.jstCalendarDays+1&&day<=today&&!days.has(day)) {
      keep.add(record.receiptId);days.add(day);
    }
  }
  return keep;
}
const candidate=record=>({receiptId:record.receiptId,receiptDigest:digest(record),dumpKey:record.dumpKey,recoveryKey:record.recoveryKey,
  dumpSha256:record.dumpSha256,recoverySha256:record.recoverySha256,dumpEtag:record.dumpEtag,recoveryEtag:record.recoveryEtag,
  bytes:add(record.dumpBytes,record.recoveryBytes)});

/** Input receipts must be independently discovered/reverified; this module never loads supervisor files.
 * All decisions describe the supplied metadata only. This function never authorizes DELETE or PUT.
 */
export function planBackupRetention({identity,scope,protectedPair,receipts,inventoryLimit,budgets,planNonce,now}={}) {
  const count=Array.isArray(receipts)?receipts.length:0;
  if(!Number.isInteger(inventoryLimit)||inventoryLimit<1||inventoryLimit>MAX_RETENTION_INVENTORY||!Array.isArray(receipts))return fail('inventory_unverified',count);
  if(count>inventoryLimit)return fail('inventory_limit',count);
  const expected=metadata(identity,identityFields),target=metadata(scope,scopeFields),budget=metadata(budgets,budgetFields);
  if(!expected||!uuid(expected.instanceId)||!uuid(expected.generation)||!/^\d{10,20}$/.test(expected.databaseSystemIdentifier??'')
    ||!Number.isSafeInteger(now)||now<0||!Number.isFinite(new Date(now).getTime())||!Number.isFinite(utc(expected.startedAt))||!uuid(planNonce)
    ||!target||!scopeFields.every(field=>hash(target[field])))return fail('identity_unverified',count);
  const binding={...expected,...target,planNonce,plannedAt:new Date(now).toISOString()};
  if(utc(expected.startedAt)>now)return fail('future_clock',count,binding);
  if(!budget||!budgetFields.every(field=>Object.hasOwn(budget,field))
    ||!budgetFields.every(field=>field==='remoteBaselineBytes'&&budget[field]===null||bytes(budget[field]))
    ||budget.nextPairBytes<72)return fail('budget_unverified',count,binding);
  const slots=Object.getOwnPropertyDescriptors(receipts);
  const records=Array.from({length:count},(_,index)=>Object.hasOwn(slots[index]??{},'value')?metadata(slots[index].value,receiptFields):null);
  const inventoryDigest=digest(records); // Null means the record was held without evaluating unknown payloads.
  if(records.some(record=>record===null))return fail('inventory_metadata_unverified',count,binding,inventoryDigest);
  const protectedRecord=metadata(protectedPair,receiptFields);
  try {
    if(records.some(record=>record&&['startedAt','capturedAt','verifiedAt'].some(field=>Number.isFinite(utc(record[field]))&&utc(record[field])>now)))
      return fail('future_clock',count,binding,inventoryDigest);
    if(!verified(protectedRecord)||protectedRecord.generation!==expected.generation||protectedRecord.startedAt!==expected.startedAt
      ||protectedRecord.instanceId!==expected.instanceId||protectedRecord.databaseSystemIdentifier!==expected.databaseSystemIdentifier
      ||scopeFields.some(field=>protectedRecord[field]!==target[field])||protectedRecord.localState!=='complete'||protectedRecord.remoteState!=='verified'
      ||now-utc(protectedRecord.verifiedAt)>=FRESH_PAIR)return fail('protected_pair_unverified',count,binding,inventoryDigest);
    const protectedDigest=digest(protectedRecord);
    if(records.filter(record=>record?.receiptId===protectedRecord.receiptId&&digest(record)===protectedDigest).length!==1)
      return fail('protected_pair_missing_or_changed',count,binding,inventoryDigest);
    const ids=new Set(),keys=new Set(),valid=[],held=[];
    for(const record of records) {
      if(record?.receiptId) {if(ids.has(record.receiptId))return fail('inventory_conflict',count,binding,inventoryDigest);ids.add(record.receiptId);}
      // A held attempt naming the same object makes its state ambiguous, even if another receipt says verified.
      for(const key of [record?.dumpKey,record?.recoveryKey].filter(value=>typeof value==='string')) {
        if(keys.has(key))return fail('inventory_conflict',count,binding,inventoryDigest);keys.add(key);
      }
      if(!verified(record)) {held.push(record);continue;}
      if(record.instanceId!==expected.instanceId||record.databaseSystemIdentifier!==expected.databaseSystemIdentifier
        ||scopeFields.some(field=>record[field]!==target[field]))return fail('scope_mismatch',count,binding,inventoryDigest);
      valid.push(record);
    }
    valid.sort((a,b)=>utc(b.capturedAt)-utc(a.capturedAt)||a.receiptId.localeCompare(b.receiptId));
    let localBytes=0,remoteBytes=budget.remoteBaselineBytes??0,unknownSizeCount=0;
    for(const record of records) {
      if(!record||!bytes(record.localBytes)||!bytes(record.remoteBytes))unknownSizeCount++;
      else {localBytes=add(localBytes,record.localBytes);remoteBytes=add(remoteBytes,record.remoteBytes);}
    }
    const retained={local:[],remote:[]},removalCandidates={local:[],remote:[]};
    let localReclaim=0,remoteReclaim=0;
    for(const location of ['local','remote']) {
      const available=valid.filter(record=>record[location+'State']===(location==='local'?'complete':'verified'));
      const keep=keepIds(available,RETENTION_POLICY[location+'Latest'],protectedRecord.receiptId,now);
      for(const record of available) {
        if(keep.has(record.receiptId))retained[location].push({receiptId:record.receiptId,receiptDigest:digest(record)});
        else {removalCandidates[location].push(candidate(record));if(location==='local')localReclaim=add(localReclaim,record.localBytes);else remoteReclaim=add(remoteReclaim,record.remoteBytes);}
      }
    }
    const projected={localBytes:add(localBytes,budget.nextPairBytes),remoteBytes:add(remoteBytes,budget.nextPairBytes),
      freeLocalBytes:budget.freeLocalBytes-budget.nextPairBytes,requestCount:6,transferBytes:add(budget.nextPairBytes,budget.nextPairBytes)};
    const unverified=unknownSizeCount>0||budget.remoteBaselineBytes===null;
    const within=!unverified&&projected.localBytes<=budget.maxLocalBytes&&projected.remoteBytes<=budget.maxRemoteBytes
      &&projected.freeLocalBytes>=budget.minFreeLocalBytes&&projected.requestCount<=budget.maxRequestCount&&projected.transferBytes<=budget.maxTransferBytes;
    const quota={decision:unverified?'unverified':within?'within_budget':'exceeded',current:{localBytes,remoteBytes},projectedBeforeAnyRemoval:projected,
      candidateReclaim:{localBytes:localReclaim,remoteBytes:remoteReclaim},limits:budget};
    const result={version:1,dryRun:true,decision:{planningAllowed:true,writeAllowed:within,reason:quota.decision},binding,inventoryDigest,
      protectedPair:{receiptId:protectedRecord.receiptId,receiptDigest:protectedDigest},retained,removalCandidates,
      held:{count:held.length,unknownSizeCount},quota};
    return {...result,planDigest:digest({...result,policy:RETENTION_POLICY})};
  } catch {return fail('numeric_or_metadata_unverified',count,binding,inventoryDigest);}
}
