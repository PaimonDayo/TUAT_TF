import { lstatSync, realpathSync, openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { isAbsolute, resolve, dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
// Existing command-output limits plus conservative JSON escaping and small metadata.
export const BACKUP_LIMITS=Object.freeze({dumpBytes:128*1024*1024,sqlBytes:16*1024*1024,pushBytes:64*1024,
  recoveryBytes:6*(2*16*1024*1024+64*1024)+64*1024,metadataBytes:16*1024*1024,inventory:4096});
export const MIN_MAX_PAIR_BYTES=BACKUP_LIMITS.dumpBytes+BACKUP_LIMITS.recoveryBytes+72;
export function validateCapacity(capacity,{required=true}={}) {
  if(capacity===undefined&&!required)return;
  const fields=['inventoryLimit','maxLocalBytes','maxRemoteBytes','minFreeLocalBytes','maxPairBytes','maxRequestCount','maxTransferBytes'];
  if(!capacity||typeof capacity!=='object'||Array.isArray(capacity)||Object.keys(capacity).length!==fields.length
    ||!fields.every(field=>Object.hasOwn(capacity,field)&&Number.isSafeInteger(capacity[field])&&capacity[field]>=0)
    ||capacity.inventoryLimit<1||capacity.inventoryLimit>BACKUP_LIMITS.inventory||capacity.maxPairBytes<MIN_MAX_PAIR_BYTES
    ||capacity.maxPairBytes>Number.MAX_SAFE_INTEGER-BACKUP_LIMITS.metadataBytes||capacity.maxRequestCount<1)
    throw Error('Explicit complete backup capacity required');
}
export function validateBackupConfig(config,env) {
  if(config?.version!==1||typeof config.enabled!=='boolean'||!uuid(config.instanceId)) throw Error('Explicit backup configuration required');
  for(const key of ['stateDirectory','environmentFile','wslExecutable']) if(!isAbsolute(config[key]??'')) throw Error('Absolute backup paths required');
  for(const key of ['psqlExecutable','pgDumpExecutable']) if(!/^\/[A-Za-z0-9_./-]+$/.test(config[key]??'')) throw Error('Absolute database commands required');
  if(resolve(config.stateDirectory)===dirname(resolve(config.environmentFile))) throw Error('Separate private backup state required');
  if(!hash(config.wslSha256)||!hash(config.dockerSha256)||!/^\/[A-Za-z0-9_./-]+$/.test(config.dockerExecutable??'')
    ||!/^[-A-Za-z0-9_.]{1,64}$/.test(config.wslDistribution??'')||!/^[-A-Za-z0-9_]{1,32}$/.test(config.wslUser??'')) throw Error('Pinned backup commands required');
  const target=config.target;
  if(!target||!hash(target.containerId)||!/^sha256:[a-f0-9]{64}$/.test(target.containerImageId??'')||!/^\d{10,20}$/.test(target.databaseSystemIdentifier??'')
    ||target.databaseName!=='postgres'||!/^[-A-Za-z0-9_.]{1,64}$/.test(target.containerName??'')
    ||!/^[-A-Za-z0-9_.]{1,64}$/.test(target.composeProject??'')||target.composeService!=='db'
    ||!/^\/[A-Za-z0-9_./-]+$/.test(target.dataMountSource??'')) throw Error('Exact owned PC database target required');
  if(config.pushEnvironmentFile!==null&&!isAbsolute(config.pushEnvironmentFile??'')) throw Error('Explicit Push recovery path or null required');
  validateCapacity(config.capacity,{required:config.enabled});
  if(config.localSnapshotReceiptFile!==undefined && (!isAbsolute(config.localSnapshotReceiptFile)||resolve(config.localSnapshotReceiptFile)!==config.localSnapshotReceiptFile||
      !isAbsolute(config.localImageRoot??'')||resolve(config.localImageRoot)!==config.localImageRoot)) throw Error('Explicit private local snapshot receipt and image root required');
  if(env!==undefined) {
    const allowed=['PC_BACKUP_ENCRYPTION_KEY','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME'];
    if(Object.keys(env).some(name=>!allowed.includes(name))||!hash(env.PC_BACKUP_ENCRYPTION_KEY)) throw Error('Dedicated backup environment required');
    if(!/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID??'')||!allowed.slice(2).every(name=>typeof env[name]==='string'&&env[name].length>0&&!/[\r\n\0]/.test(env[name]))) throw Error('Dedicated backup storage credentials required');
  }
  return config;
}
export function verifyPrivatePath(file,maxBytes=128*1024) {
  if(!isAbsolute(file)) throw Error('Absolute private file required');
  const parent=dirname(file),stat=lstatSync(file),directory=lstatSync(parent),normalize=value=>process.platform==='win32'?value.toLowerCase():value;
  if(!stat.isFile()||stat.isSymbolicLink()||!directory.isDirectory()||directory.isSymbolicLink()||stat.size>maxBytes
    ||normalize(realpathSync(file))!==normalize(resolve(file))||normalize(realpathSync(parent))!==normalize(resolve(parent))) throw Error('Private file may not be redirected');
  // Loading/checking never mkdir/chmod or repairs unsafe pre-existing credentials.
  if(process.platform==='win32') {
    const script="$ErrorActionPreference='Stop'; $owner=[Security.Principal.WindowsIdentity]::GetCurrent().User; $system=[Security.Principal.SecurityIdentifier]::new('S-1-5-18'); foreach($path in @($env:TUAT_BACKUP_PRIVATE_FILE,$env:TUAT_BACKUP_PRIVATE_PARENT)){ $check=Get-Acl -LiteralPath $path; if($check.Access.Count -ne 2 -or ($path -eq $env:TUAT_BACKUP_PRIVATE_PARENT -and !$check.AreAccessRulesProtected)){throw 'Private ACL invalid'}; foreach($rule in $check.Access){if($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($owner.Value,$system.Value) -or $rule.AccessControlType -ne 'Allow'){throw 'Private ACL invalid'}} }";
    execFileSync(resolve(process.env.ProgramFiles,'PowerShell/7/pwsh.exe'),['-NoProfile','-NonInteractive','-Command',script],{stdio:'ignore',timeout:10_000,windowsHide:true,
      env:{...process.env,PSModulePath:resolve(process.env.ProgramFiles,'PowerShell/7/Modules'),TUAT_BACKUP_PRIVATE_FILE:file,TUAT_BACKUP_PRIVATE_PARENT:parent}});
  } else if(directory.uid!==process.getuid()||stat.uid!==process.getuid()||(directory.mode&0o077)||(stat.mode&0o077)) throw Error('Private ownership and modes required');
  return stat;
}
export function readPrivateFile(file,maxBytes=128*1024) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>128*1024)throw Error('Invalid private read bound');
  const stat=verifyPrivatePath(file,maxBytes),fd=openSync(file,'r');
  try {
    const opened=fstatSync(fd);
    if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size||opened.mtimeMs!==stat.mtimeMs)throw Error('Private file changed');
    const buffer=Buffer.alloc(maxBytes+1);let length=0,count;
    while(length<buffer.length&&(count=readSync(fd,buffer,length,buffer.length-length,null)))length+=count;
    const bytes=buffer.subarray(0,length),after=fstatSync(fd),current=lstatSync(file);
    if(bytes.length>maxBytes||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||current.dev!==stat.dev||current.ino!==stat.ino)
      throw Error('Private file changed');
    return bytes;
  } finally {closeSync(fd);}
}
export function loadBackup(configFile) {
  const config=JSON.parse(readPrivateFile(configFile));
  validateBackupConfig(config);
  const env=parseEnv(readPrivateFile(config.environmentFile).toString('utf8'));
  validateBackupConfig(config,env);
  return {config,env};
}
