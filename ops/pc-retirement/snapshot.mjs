import { createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,writeFileSync } from 'node:fs';
import { dirname,isAbsolute,parse,resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { hostGitPath,hostWindowsToolPath } from '../pc-host/runtime-manifest.mjs';

const header=Buffer.from('TUATR001');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function requireKey(key) { if (!Buffer.isBuffer(key) || key.length!==32) throw Error('Private 256-bit encryption key required in memory'); }
export function encrypt(bytes,key,kind) {
  requireKey(key);
  if (!['snapshot','dry-run'].includes(kind)) throw Error('Snapshot pair kind required');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(`TUATR001:${kind}`));
  const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return Buffer.concat([header,iv,cipher.getAuthTag(),encrypted]);
}
function decrypt(bytes,key,kind) {
  requireKey(key);
  if (!Buffer.isBuffer(bytes) || bytes.length<36 || !bytes.subarray(0,8).equals(header)) throw Error('Encrypted snapshot format invalid');
  const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20));
  cipher.setAAD(Buffer.from(`TUATR001:${kind}`)); cipher.setAuthTag(bytes.subarray(20,36));
  return Buffer.concat([cipher.update(bytes.subarray(36)),cipher.final()]);
}
export function prepareEncryptedPair({snapshot,report},key) {
  if (report?.readOnly!==true || report.retirementReady!==false || report.triggerAndJournalEffectsVerified!==false) throw Error('Unproved retirement must remain held');
  const captureId=randomUUID(),snapshotPlain=Buffer.from(JSON.stringify({version:1,captureId,kind:'snapshot',payload:snapshot}));
  const reportPlain=Buffer.from(JSON.stringify({version:1,captureId,kind:'dry-run',snapshotSha256:hash(snapshotPlain),payload:report}));
  if (snapshotPlain.length>64*1024*1024 || reportPlain.length>16*1024*1024) throw Error('Encrypted capture size budget exceeded');
  const snapshotBytes=encrypt(snapshotPlain,key,'snapshot'),reportBytes=encrypt(reportPlain,key,'dry-run');
  verifyEncryptedPair(snapshotBytes,reportBytes,key);
  return {captureId,snapshotBytes,reportBytes,snapshotSha256:hash(snapshotBytes),reportSha256:hash(reportBytes)};
}
export function verifyEncryptedPair(snapshotBytes,reportBytes,key) {
  const snapshotPlain=decrypt(snapshotBytes,key,'snapshot'),reportPlain=decrypt(reportBytes,key,'dry-run');
  const snapshot=JSON.parse(snapshotPlain.toString('utf8')),report=JSON.parse(reportPlain.toString('utf8'));
  if (snapshot.version!==1 || report.version!==1 || snapshot.kind!=='snapshot' || report.kind!=='dry-run' ||
    snapshot.captureId!==report.captureId || !/^[a-f0-9-]{36}$/.test(snapshot.captureId ?? '') || report.snapshotSha256!==hash(snapshotPlain) ||
    report.payload?.readOnly!==true || report.payload.retirementReady!==false || report.payload.triggerAndJournalEffectsVerified!==false) throw Error('Authenticated snapshot pair binding failed');
  return {captureId:snapshot.captureId,snapshot:snapshot.payload,report:report.payload};
}
function rejectGitAncestor(directory) {
  let current=resolve(directory);
  while (true) {
    if (existsSync(resolve(current,'.git'))) throw Error('Snapshots must be outside every Git checkout');
    const parent=dirname(current); if (parent===current) break; current=parent;
  }
}
function powerShell() {
  const pwsh=resolve(dirname(hostGitPath()),'../../PowerShell/7/pwsh.exe');
  if (!existsSync(pwsh) || realpathSync(pwsh).toLowerCase()!==pwsh.toLowerCase()) throw Error('Pinned PowerShell 7 required');
  return pwsh;
}
function privateDirectory(directory) {
  // Never repair an existing unsafe directory. Require an existing reviewed
  // parent; recursive creation could leave unreviewed intermediate permissions.
  if (existsSync(directory)) return;
  mkdirSync(directory,{mode:0o700});
  if (process.platform==='win32') {
    const pwsh=powerShell();
    const owner=execFileSync(pwsh,['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],
      {encoding:'utf8',windowsHide:true,env:{...process.env,PSModulePath:resolve(dirname(pwsh),'Modules')}}).trim();
    if (!/^S-1-\d+(?:-\d+)+$/.test(owner)) throw Error('Snapshot execution owner unavailable');
    const identities=[...new Set([owner,'S-1-5-18'])];
    execFileSync(hostWindowsToolPath('icacls'),[directory,'/inheritance:r','/grant:r',...identities.map(sid=>`*${sid}:(OI)(CI)(F)`)],
      {stdio:'ignore',windowsHide:true});
  }
}
function assertPrivate(directory,files=[]) {
  if (process.platform==='win32') {
    const pwsh=powerShell();
    execFileSync(pwsh,['-NoProfile','-NonInteractive','-File',resolve(import.meta.dirname,'check-private.ps1'),'-Directory',directory,...(files.length?['-FileNames',files.join(',')]:[])],
      {stdio:'ignore',windowsHide:true,env:{...process.env,PSModulePath:resolve(dirname(pwsh),'Modules')}});
  } else {
    const uid=process.getuid();
    for (const path of [directory,...files.map(name=>resolve(directory,name))]) {
      const stat=lstatSync(path),isDir=path===directory;
      if (stat.isSymbolicLink() || stat.uid!==uid || (stat.mode&0o777)!==(isDir?0o700:0o600)) throw Error('Owner-private snapshot permission required');
    }
    for (let parent=dirname(directory);;parent=dirname(parent)) {
      const stat=lstatSync(parent);
      const rootSticky=stat.uid===0 && (stat.mode&0o1000)!==0;
      if ((stat.uid!==0 && stat.uid!==uid) || ((stat.mode&0o022)!==0 && !rootSticky) || stat.isSymbolicLink()) throw Error('Unsafe snapshot parent replacement permission');
      if (parent===dirname(parent)) break;
    }
  }
}

/** Ciphertext only, fresh files, never cleanup the sole/partial snapshot.
 * This function is not called by any CLI in this preparation candidate.
 */
export function prepareSnapshotDirectory(directory) {
  if (!isAbsolute(directory) || resolve(directory)===parse(resolve(directory)).root) throw Error('Dedicated private snapshot directory required');
  rejectGitAncestor(directory); privateDirectory(directory); assertPrivate(directory);
}
export function persistEncryptedPair(directory,pair,key) {
  prepareSnapshotDirectory(directory);
  if (!/^[a-f0-9-]{36}$/.test(pair.captureId ?? '')) throw Error('Snapshot capture identifier required');
  const names=[`${pair.captureId}.snapshot.enc`,`${pair.captureId}.dry-run.enc`];
  if (verifyEncryptedPair(pair.snapshotBytes,pair.reportBytes,key).captureId!==pair.captureId) throw Error('Encrypted pair identifier differs');
  for (const [index,bytes] of [pair.snapshotBytes,pair.reportBytes].entries()) {
    const descriptor=openSync(resolve(directory,names[index]),'wx',0o600);
    try { writeFileSync(descriptor,bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }
  assertPrivate(directory,names);
  const snapshotRead=readFileSync(resolve(directory,names[0])),reportRead=readFileSync(resolve(directory,names[1]));
  if (snapshotRead.length!==pair.snapshotBytes.length || reportRead.length!==pair.reportBytes.length ||
    !timingSafeEqual(snapshotRead,pair.snapshotBytes) || !timingSafeEqual(reportRead,pair.reportBytes)) throw Error('Encrypted pair readback bytes differ');
  const verified=verifyEncryptedPair(snapshotRead,reportRead,key);
  if (verified.captureId!==pair.captureId) throw Error('Encrypted pair readback identifier differs');
  return {captureId:pair.captureId,snapshotSha256:hash(snapshotRead),reportSha256:hash(reportRead),authenticatedReadback:true};
}
