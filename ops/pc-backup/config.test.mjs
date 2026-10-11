import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCapacity,MIN_MAX_PAIR_BYTES,BACKUP_LIMITS } from './config.mjs';

const valid=()=>({inventoryLimit:512,maxLocalBytes:10**12,maxRemoteBytes:10**12,minFreeLocalBytes:1024,
  maxPairBytes:MIN_MAX_PAIR_BYTES,maxRequestCount:10_000,maxTransferBytes:10**12});
test('one explicit capacity block has no inferred enabled defaults',()=>{
  assert.doesNotThrow(()=>validateCapacity(valid()));assert.doesNotThrow(()=>validateCapacity(undefined,{required:false}));
  for(const value of [undefined,{}, {...valid(),extra:1},{...valid(),maxPairBytes:MIN_MAX_PAIR_BYTES-1},
    {...valid(),inventoryLimit:BACKUP_LIMITS.inventory+1},{...valid(),maxRemoteBytes:NaN},{...valid(),maxLocalBytes:Number.MAX_SAFE_INTEGER+1}])
    assert.throws(()=>validateCapacity(value));
});
test('pair reservation derives bounded dump plus conservatively escaped recovery and encryption overhead',()=>{
  assert.equal(MIN_MAX_PAIR_BYTES,BACKUP_LIMITS.dumpBytes+BACKUP_LIMITS.recoveryBytes+72);
  assert(BACKUP_LIMITS.recoveryBytes>=6*(2*BACKUP_LIMITS.sqlBytes+BACKUP_LIMITS.pushBytes));
});
