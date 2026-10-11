import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReadOnlyReader,captureReadOnly} from './reconcile.mjs';
import {prepareSnapshotDirectory,prepareEncryptedPair,persistEncryptedPair} from './snapshot.mjs';

/** Import-only entry for the root-reviewed wrapper. Authoritative settings,
 * physical runtime evidence and recovery key must already be verified and kept
 * in memory by that wrapper. This entry cannot discover or authorize them.
 */
export async function runReviewedCapture({cloud,pc,expected,directory,key,synthetic=false,fetchImpl,limits}) {
  try {
    const reader=createReadOnlyReader({cloud,pc,expected,synthetic,fetchImpl});
    if (!Buffer.isBuffer(key) || key.length!==32) throw Error('In-memory recovery key required before reads');
    prepareSnapshotDirectory(directory); // Fail before any response/row bytes.
    const result=await captureReadOnly(reader,limits);
    const pair=prepareEncryptedPair(result,key),receipt=persistEncryptedPair(directory,pair,key);
    return {version:1,readOnly:true,retirementReady:false,triggerAndJournalEffectsVerified:false,
      queuedChanges:result.report.queuedChanges,groups:result.report.groups,counts:result.report.counts,
      queueStable:result.report.queueStable,schemaStable:result.report.schemaStable,...receipt};
  } catch {
    // Callers may safely print this error. Never propagate headers/body/path/PK,
    // underlying native command output or a credential-bearing exception.
    throw Error('Read-only capture failed; no reconciliation write was dispatched; incomplete encrypted files remain held');
  }
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  process.stderr.write('Import-only entry: root-reviewed in-memory settings, runtime proof and recovery key are required. No capture ran.\n');
  process.exitCode=1;
}
