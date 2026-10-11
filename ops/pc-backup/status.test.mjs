import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backupStatusReady } from './status.mjs';
const fixtures=JSON.parse(readFileSync(new URL('status-vectors.json',import.meta.url),'utf8'));
for(const fixture of fixtures) test(`backup status contract: ${fixture.name}`,()=>{
  assert.equal(backupStatusReady(fixture.status,fixture.identity,fixture.now),fixture.ready);
});
