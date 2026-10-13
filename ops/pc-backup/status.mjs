// Operational contract mirrored by Next without importing this module.
export const STATUS_VERSION=1;
export const HEARTBEAT_INTERVAL_MS=20_000;
export const HEARTBEAT_MAX_AGE_MS=120_000;
export const BACKUP_INTERVAL_MS=15*60_000;
export const BACKUP_MAX_AGE_MS=35*60_000;
export const STATUS_FILE='backup-lifecycle.json';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export function utcTime(value) {
  if(typeof value!=='string') return NaN;
  const parsed=Date.parse(value);
  return Number.isFinite(parsed)&&new Date(parsed).toISOString()===value?parsed:NaN;
}
export function backupStatusReady(status,identity,now=Date.now()) {
  try {
    if(!Number.isFinite(now)||status?.version!==STATUS_VERSION||!uuid(identity?.instanceId)||!uuid(identity?.generation)
      ||status.instanceId!==identity.instanceId||status.generation!==identity.generation||status.startedAt!==identity.startedAt) return false;
    const started=utcTime(status.startedAt),heartbeat=utcTime(status.heartbeat?.checkedAt),targetAt=utcTime(status.target?.checkedAt),verified=utcTime(status.backup?.verifiedAt);
    if(![started,heartbeat,targetAt,verified].every(Number.isFinite)||started>now
      ||heartbeat<started||heartbeat>now||now-heartbeat>=HEARTBEAT_MAX_AGE_MS
      ||targetAt<started||targetAt>now||now-targetAt>=HEARTBEAT_MAX_AGE_MS
      ||verified<started||verified>now||now-verified>=BACKUP_MAX_AGE_MS) return false;
    if(status.heartbeat.healthy!==true||status.heartbeat.maintenance!==false||status.target.healthy!==true
      ||status.backup.generation!==identity.generation||!/^\d{10,20}$/.test(status.target.databaseSystemIdentifier??'')
      ||status.target.databaseSystemIdentifier!==identity.databaseSystemIdentifier
      ||status.backup.databaseSystemIdentifier!==identity.databaseSystemIdentifier||!/^[a-z_][a-z0-9_]{0,62}$/.test(identity.databaseName??'postgres')||status.target.databaseName!==(identity.databaseName??'postgres')
      ||!/^[a-f0-9]{64}$/.test(status.target.containerId??'')||!/^sha256:[a-f0-9]{64}$/.test(status.target.containerImageId??'')) return false;
    if(status.backup.localSnapshot) {
      if(!localSnapshotReady(status,identity,status.backup.localSnapshot.imageRoot,now))return false;
      if(status.backup.key===status.backup.localSnapshot.archiveKey)
        return status.backup.sha256===status.backup.localSnapshot.archiveSha256 && status.backup.bytes===status.backup.localSnapshot.archiveBytes;
    }
    const prefix=`ops/pc-backend/${identity.instanceId}/backups/`;
    const name=status.backup.key?.slice(prefix.length);
    if(typeof status.backup.key!=='string'||!status.backup.key.startsWith(prefix)
      ||!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.dump\.enc$/.test(name??'')
      ||status.backup.recoveryKey!==status.backup.key.replace(/\.dump\.enc$/,'.recovery.json.enc')
      ||!['sha256','recoverySha256'].every(field=>/^[a-f0-9]{64}$/.test(status.backup[field]??''))
      ||!['bytes','recoveryBytes'].every(field=>Number.isSafeInteger(status.backup[field])&&status.backup[field]>=36)) return false;
    return true;
  } catch { return false; }
}

export function localSnapshotReady(status,identity,imageRoot,now=Date.now()) {
  const snapshot=status.backup?.localSnapshot;
  if(!snapshot||!imageRoot||snapshot.format!=='tuat-local-db-images-v1'||snapshot.sourceId!==identity.instanceId||snapshot.generation!==identity.generation
    ||snapshot.databaseSystemIdentifier!==identity.databaseSystemIdentifier||snapshot.imageRoot!==imageRoot||snapshot.independentRecoveryCopyChecked!==true
    ||!/^[a-f0-9]{64}$/.test(snapshot.archiveSha256??'')||!Number.isSafeInteger(snapshot.archiveBytes)||snapshot.archiveBytes<36||snapshot.archiveBytes>16*1024**3)return false;
  const prefix=`ops/pc-backend/${identity.instanceId}/backups/`;
  if(!snapshot.archiveKey?.startsWith(prefix)||!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.local\.tar\.enc$/.test(snapshot.archiveKey.slice(prefix.length)))return false;
  const started=utcTime(identity.startedAt);
  const captured=utcTime(snapshot.capturedAt),restored=utcTime(snapshot.restoreVerifiedAt),offsite=utcTime(snapshot.offsiteVerifiedAt);
  return Number.isFinite(now)&&Number.isFinite(started)&&captured<=restored&&restored<=offsite
    &&[captured,restored,offsite].every(time=>Number.isFinite(time)&&time>=started&&time<=now&&now-time<BACKUP_MAX_AGE_MS);
}
