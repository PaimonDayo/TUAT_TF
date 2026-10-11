import { existsSync,openSync,closeSync,writeFileSync,fsyncSync,renameSync,unlinkSync,lstatSync,readFileSync,fstatSync,linkSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { privateDirectory } from '../pc-host/release.mjs';
export function writePrivate(file,value,{exclusive=false}={}) {
  privateDirectory(dirname(file));
  if(existsSync(file)&&(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())) throw Error('Private file redirected');
  const temp=`${file}.${randomBytes(12).toString('hex')}.tmp`;
  const fd=openSync(temp,'wx',0o600);
  try { writeFileSync(fd,Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  if(exclusive) {try {linkSync(temp,file);unlinkSync(temp);} catch(error) {unlinkSync(temp);throw error;}}
  else renameSync(temp,file);
  if(process.platform!=='win32') {const parent=openSync(dirname(file),'r');try {fsyncSync(parent);} finally {closeSync(parent);}}
}
export function acquireLock(directory,identity) {
  privateDirectory(directory);
  const file=resolve(directory,'backup-owner.lock');
  const fd=openSync(file,'wx',0o600),bytes=JSON.stringify({...identity,pid:process.pid});
  try {writeFileSync(fd,bytes);fsyncSync(fd);} catch(error) {closeSync(fd);throw error;}
  const owned=fstatSync(fd);
  const assertOwned=()=>{
    privateDirectory(directory);
    const current=lstatSync(file);
    if(!current.isFile()||current.isSymbolicLink()||current.dev!==owned.dev||current.ino!==owned.ino||readFileSync(file,'utf8')!==bytes) throw Error('Backup ownership uncertain');
  };
  return {assertOwned,release(){assertOwned();closeSync(fd);unlinkSync(file);}};
}
