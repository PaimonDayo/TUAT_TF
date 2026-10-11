import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync,writeFileSync,existsSync,rmSync } from 'node:fs';
import { resolve,relative,isAbsolute } from 'node:path';
import { acquireLock,writePrivate,readBackupInventory } from './files.mjs';
import { readPrivateFile } from './config.mjs';
import { sha256 } from './archive.mjs';
test('exclusive real lock rejects overlap and never deletes a replaced ownership record',()=>{
  const workspace=resolve('.'),directory=resolve(workspace,'.contingency',`pc-backup-test-${randomUUID()}`);
  const identity={instanceId:randomUUID(),generation:randomUUID(),startedAt:new Date().toISOString()};
  try {
    const owner=acquireLock(directory,identity),file=resolve(directory,'backup-owner.lock');
    assert.throws(()=>acquireLock(directory,identity));owner.assertOwned();
    writeFileSync(file,'synthetic replacement');assert.throws(()=>owner.release());assert.equal(existsSync(file),true);
    writePrivate(resolve(directory,'synthetic.enc'),Buffer.from('synthetic-only'));
    assert.throws(()=>writePrivate(resolve(directory,'synthetic.enc'),Buffer.from('replacement'),{exclusive:true}));
    assert.equal(readPrivateFile(resolve(directory,'synthetic.enc')).toString(),'synthetic-only');
    assert.equal(readFileSync(file,'utf8'),'synthetic replacement');
  } finally {
    const inside=relative(workspace,directory);
    if(!inside.startsWith('..')&&!isAbsolute(inside)&&inside.startsWith('.contingency')&&directory.includes('pc-backup-test-')) rmSync(directory,{recursive:true,force:true});
  }
});
test('read-only private load does not create a missing parent',()=>{
  const parent=resolve('.contingency',`pc-backup-missing-${randomUUID()}`);
  assert.throws(()=>readPrivateFile(resolve(parent,'missing.env')));assert.equal(existsSync(parent),false);
});

test('private synthetic inventory accounts entire state and hashes one archive at a time',()=>{
  const directory=resolve('.contingency',`pc-backup-test-${randomUUID()}`),receiptId=randomUUID(),stamp='2026-10-11T00-30-00-000Z';
  const bytes=Buffer.alloc(3*1024*1024,7);
  try {
    writePrivate(resolve(directory,`backup-${stamp}.enc`),bytes);
    writePrivate(resolve(directory,'legacy.enc'),Buffer.from('retained legacy'));
    writePrivate(resolve(directory,'status.json'),{synthetic:true});
    writePrivate(resolve(directory,'receipts',`${receiptId}.json`),{state:'prepared',receiptId,localBytes:100,remoteBytes:100});
    const inventory=readBackupInventory({stateDirectory:directory,inventoryLimit:16,maxPairBytes:4*1024*1024});
    assert.equal(inventory.complete,true);assert.equal(inventory.files.length,4);assert.equal(inventory.receipts.length,1);
    assert.equal(inventory.archives[0].sha256,sha256(bytes));assert.equal(inventory.totalBytes,inventory.files.reduce((sum,file)=>sum+file.bytes,0));
    assert(inventory.freeLocalBytes>0);
    assert.throws(()=>readBackupInventory({stateDirectory:directory,inventoryLimit:2,maxPairBytes:4*1024*1024}));
    const controller=new AbortController();controller.abort();assert.throws(()=>readBackupInventory({stateDirectory:directory,inventoryLimit:16,maxPairBytes:4*1024*1024,signal:controller.signal}));
    writePrivate(resolve(directory,'unexpected','held.json'),{synthetic:true});
    assert.throws(()=>readBackupInventory({stateDirectory:directory,inventoryLimit:16,maxPairBytes:4*1024*1024}));
  } finally {
    const inside=relative(resolve('.'),directory);if(!inside.startsWith('..')&&!isAbsolute(inside)&&inside.startsWith('.contingency')&&directory.includes('pc-backup-test-'))rmSync(directory,{recursive:true,force:true});
  }
});
test('malformed private receipt is held without promoting local archive filenames',()=>{
  const directory=resolve('.contingency',`pc-backup-test-${randomUUID()}`);
  try {
    writePrivate(resolve(directory,'receipts',`${randomUUID()}.json`),Buffer.from('not-json'));
    const inventory=readBackupInventory({stateDirectory:directory,inventoryLimit:4,maxPairBytes:1000});
    assert.deepEqual(inventory.receipts,[{state:'malformed'}]);assert.equal(inventory.archives.length,0);
  } finally {
    const inside=relative(resolve('.'),directory);if(!inside.startsWith('..')&&!isAbsolute(inside)&&inside.startsWith('.contingency')&&directory.includes('pc-backup-test-'))rmSync(directory,{recursive:true,force:true});
  }
});
