import { existsSync,openSync,closeSync,writeFileSync,fsyncSync,renameSync,unlinkSync,lstatSync,readFileSync,fstatSync,linkSync,opendirSync,readSync,statfsSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { randomBytes,createHash } from 'node:crypto';
import { privateDirectory } from '../pc-host/release.mjs';
import { readPrivateFile,verifyPrivatePath } from './config.mjs';
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

// Read only: the entire dedicated state is accounted, including receipts, metadata,
// incomplete temp files and legacy archives. No symlink or unknown directory is followed.
export function readBackupInventory({stateDirectory,inventoryLimit,maxPairBytes,signal,deadlineMilliseconds=120_000}={}) {
  if(!Number.isInteger(inventoryLimit)||inventoryLimit<1||inventoryLimit>4096||!Number.isSafeInteger(maxPairBytes)||maxPairBytes<72)
    throw Error('Invalid local inventory bound');
  if(!Number.isInteger(deadlineMilliseconds)||deadlineMilliseconds<1||deadlineMilliseconds>120_000)throw Error('Invalid local inventory deadline');
  const root=resolve(stateDirectory),started=Date.now(),files=[],receipts=[],archives=[];
  let totalBytes=0;
  const check=()=>{if(signal?.aborted||Date.now()-started>deadlineMilliseconds)throw Error('Local inventory interrupted');};
  const add=value=>{totalBytes+=value;if(!Number.isSafeInteger(totalBytes))throw Error('Local inventory size overflow');};
  function visit(directory,nested=false) {
    const before=lstatSync(directory);
    if(!before.isDirectory()||before.isSymbolicLink())throw Error('Local inventory redirected');
    const stream=opendirSync(directory);
    try {for(let entry;(entry=stream.readSync());) {
      check();if(files.length>=inventoryLimit)throw Error('Local inventory limit');
      const file=resolve(directory,entry.name),stat=lstatSync(file);
      if(stat.isDirectory()&&!nested&&entry.name==='receipts'){visit(file,true);continue;}
      if(!stat.isFile()||stat.isSymbolicLink())throw Error('Local inventory redirected');
      const verified=verifyPrivatePath(file,Number.MAX_SAFE_INTEGER);check();add(verified.size);
      const name=nested?`receipts/${entry.name}`:entry.name;
      files.push({name,bytes:verified.size});
      if(nested) {
        if(!/^[a-f0-9-]{36}\.json$/.test(entry.name)||verified.size>16*1024) {receipts.push({state:'malformed'});continue;}
        try {const receipt=JSON.parse(readPrivateFile(file,16*1024));if(receipt?.receiptId+'.json'!==entry.name)throw Error('Receipt filename changed');receipts.push(receipt);}
        catch {receipts.push({state:'malformed'});}
      } else if(/^(backup|recovery)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.enc$/.test(entry.name)) {
        let hash=null;
        if(verified.size<=maxPairBytes) {
          const fd=openSync(file,'r'),digest=createHash('sha256'),buffer=Buffer.alloc(64*1024);
          try {
            const opened=fstatSync(fd);
            if(opened.dev!==verified.dev||opened.ino!==verified.ino||opened.size!==verified.size||opened.mtimeMs!==verified.mtimeMs)throw Error('Local archive changed');
            for(let bytes;(bytes=readSync(fd,buffer,0,buffer.length,null));) {check();digest.update(buffer.subarray(0,bytes));}
            const after=fstatSync(fd),current=lstatSync(file);
            if(after.size!==verified.size||after.mtimeMs!==verified.mtimeMs||current.dev!==verified.dev||current.ino!==verified.ino)throw Error('Local archive changed');
            hash=digest.digest('hex');
          } finally {closeSync(fd);}
        }
        archives.push({name,bytes:verified.size,sha256:hash});
      }
    }} finally {stream.closeSync();}
    const after=lstatSync(directory);
    if(after.dev!==before.dev||after.ino!==before.ino||after.mtimeMs!==before.mtimeMs)throw Error('Local directory changed');
  }
  visit(root);check();
  const stat=statfsSync(root,{bigint:true}),free=stat.bavail*stat.bsize;
  if(free<0n||free>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Local free capacity unverified');
  return {complete:true,files,receipts,archives,totalBytes,freeLocalBytes:Number(free)};
}
