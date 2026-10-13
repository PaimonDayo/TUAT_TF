import { lstatSync,realpathSync,openSync,closeSync,writeFileSync,fchownSync,fchmodSync,fsyncSync,renameSync,unlinkSync } from 'node:fs';
import { dirname,isAbsolute,resolve,relative,sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { STATUS_FILE } from './status.mjs';

export function validateApplicationStatus(config) {
  const fields=['applicationStatusDirectory','applicationStatusGid'];
  if(!fields.some(key=>Object.hasOwn(config,key)))return;
  const directory=config.applicationStatusDirectory;
  if(config.executionMode!=='linux'||!isAbsolute(directory??'')||resolve(directory)!==directory||
    !Number.isInteger(config.applicationStatusGid)||config.applicationStatusGid<1000||config.applicationStatusGid>2147483647)throw Error('Explicit Linux application status reader required');
  for(const privateRoot of [config.stateDirectory,dirname(config.environmentFile)]) {
    const nested=(a,b)=>{const delta=relative(a,b);return delta===''||(delta!=='..'&&!delta.startsWith('..'+sep)&&!isAbsolute(delta));};
    if(nested(privateRoot,directory)||nested(directory,privateRoot))throw Error('Application status must be separate from private state and credentials');
  }
}

const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value??{},key)).map(key=>[key,value[key]]));
/** Metadata only. Credentials and unknown producer fields never reach the app. */
export function applicationStatusMetadata(status) {
  const result=pick(status,['version','instanceId','generation','startedAt']);
  result.heartbeat=pick(status.heartbeat,['checkedAt','healthy','maintenance']);
  result.target=pick(status.target,['checkedAt','healthy','databaseSystemIdentifier','databaseName','containerId','containerImageId']);
  result.backup=status.backup===null?null:pick(status.backup,['generation','verifiedAt','key','recoveryKey','sha256','recoverySha256','bytes','recoveryBytes','databaseSystemIdentifier']);
  if(status.backup?.localSnapshot)result.backup.localSnapshot=pick(status.backup.localSnapshot,['format','sourceId','generation','databaseSystemIdentifier','imageRoot','archiveKey','archiveSha256','archiveBytes','restoreVerifiedAt','offsiteVerifiedAt','independentRecoveryCopyChecked']);
  return result;
}

export function writeApplicationStatus(config,status) {
  validateApplicationStatus(config);
  if(process.platform!=='linux'||process.getuid()!==0)throw Error('Root Linux status publisher required');
  const directory=config.applicationStatusDirectory,gid=config.applicationStatusGid;
  for(let path=directory;;path=dirname(path)) {
    const info=lstatSync(path);
    if(!info.isDirectory()||info.isSymbolicLink()||realpathSync(path)!==path||info.uid!==0||(info.mode&0o022))throw Error('Application status path is writable or redirected');
    if(path===directory&&(info.gid!==gid||(info.mode&0o777)!==0o750))throw Error('Application status reader permissions differ');
    if(dirname(path)===path)break;
  }
  const file=resolve(directory,STATUS_FILE);
  const existing=lstatSync(file,{throwIfNoEntry:false});
  if(existing) {
    const info=existing;
    if(!info.isFile()||info.isSymbolicLink()||info.uid!==0||info.gid!==gid||(info.mode&0o777)!==0o640)throw Error('Application status file ownership differs');
  }
  const bytes=Buffer.from(JSON.stringify(applicationStatusMetadata(status))+'\n');
  if(bytes.length>16384)throw Error('Application status exceeds reader bound');
  const temp=file+'.'+randomBytes(12).toString('hex')+'.tmp',fd=openSync(temp,'wx',0o600);
  try {writeFileSync(fd,bytes);fchownSync(fd,0,gid);fchmodSync(fd,0o640);fsyncSync(fd);}
  catch(error){try{unlinkSync(temp);}catch{}throw error;}
  finally{closeSync(fd);}
  try{renameSync(temp,file);}catch(error){try{unlinkSync(temp);}catch{}throw error;}
  const parent=openSync(directory,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
}
