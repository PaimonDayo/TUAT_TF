import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { probeRelease, stopChild } from './run.mjs';

async function childFixture() {
  const child=spawn(process.execPath,['--require',resolve(import.meta.dirname,'graceful-control.cjs'),'-e',"process.on('SIGTERM',()=>process.exit(0));process.send('ready');setInterval(()=>{},1000)"],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  const exited=once(child,'exit'); await once(child,'message'); return {child,exited};
}
test('graceful IPC stops only owned child and clears shutdown deadline', async () => {
  const {child,exited}=await childFixture();
  const start=Date.now();assert.equal(await stopChild(child,exited,2000),true);assert.ok(Date.now()-start<1000);
  assert.equal(child.exitCode,0);
});
test('owned Next child exits when parent IPC disconnects', async () => {
  const {child,exited}=await childFixture();child.disconnect();await exited;assert.equal(child.exitCode,0);
});
test('version readiness requires both pinned identifiers without redirects', async () => {
  const config={appPort:18200,releaseCommit:'a'.repeat(40),releaseId:'fixed'};
  let options;
  const fetchRequest=async(_url,init)=>{options=init;return Response.json({version:config.releaseCommit,releaseId:'other'});};
  assert.equal(await probeRelease(config,fetchRequest),false);assert.equal(options.redirect,'error');
  assert.equal(await probeRelease(config,async()=>Response.json({version:config.releaseCommit,releaseId:config.releaseId})),true);
});
