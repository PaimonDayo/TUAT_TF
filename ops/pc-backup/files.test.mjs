import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync,writeFileSync,existsSync,rmSync } from 'node:fs';
import { resolve,relative,isAbsolute } from 'node:path';
import { acquireLock,writePrivate } from './files.mjs';
import { readPrivateFile } from './config.mjs';
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
