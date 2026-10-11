import { createHash } from 'node:crypto';
import { encryptBackup,decryptBackup,verifyRecovery } from '../laptop/backup-backend.mjs';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export function encryptedPair({dump,recovery,instanceId,key,stamp}) {
  if(!Buffer.isBuffer(dump)||dump.length<6||dump.subarray(0,5).toString()!=='PGDMP') throw Error('Incomplete database dump');
  const metadata={...recovery,instanceId,databaseDumpSha256:sha256(dump)};
  const recoveryBytes=encryptBackup(Buffer.from(JSON.stringify(metadata)),key);
  verifyRecovery(decryptBackup(recoveryBytes,key),dump,instanceId);
  const bytes=encryptBackup(dump,key);
  if(!decryptBackup(bytes,key).equals(dump)) throw Error('Backup encryption verification failed');
  const objectKey=`ops/pc-backend/${instanceId}/backups/${stamp}.dump.enc`;
  return {bytes,recoveryBytes,key:objectKey,recoveryKey:objectKey.replace('.dump.enc','.recovery.json.enc'),sha256:sha256(bytes),recoverySha256:sha256(recoveryBytes)};
}
