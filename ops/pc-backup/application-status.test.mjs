import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve,dirname } from 'node:path';
import { applicationStatusMetadata,validateApplicationStatus,verifyApplicationStatusDirectory } from './application-status.mjs';

test('application receives health metadata without private producer or credential fields',()=>{
  const status={version:1,instanceId:'synthetic',generation:'synthetic',startedAt:'synthetic',secret:'private',
    heartbeat:{checkedAt:'synthetic',healthy:false,maintenance:true,secret:'private'},
    target:{databaseName:'synthetic',containerId:'synthetic',secret:'private'},
    backup:{generation:'synthetic',key:'synthetic',secret:'private',localSnapshot:{format:'synthetic',imageRoot:'synthetic',secret:'private'}}};
  const visible=applicationStatusMetadata(status);
  assert.equal(JSON.stringify(visible).includes('private'),false);
  assert.equal(visible.heartbeat.healthy,false);assert.equal(visible.heartbeat.maintenance,true);
  assert.equal(visible.backup.localSnapshot.imageRoot,'synthetic');
  assert.equal(applicationStatusMetadata({...status,backup:null}).backup,null);
});

test('shared status cannot expose a private directory or accept an implicit reader group',()=>{
  const base=resolve('synthetic-status-proof');
  const cfg={executionMode:'linux',stateDirectory:resolve(base,'state'),environmentFile:resolve(base,'private','backup.env'),applicationStatusDirectory:resolve(base,'reader'),applicationStatusGid:65530};
  validateApplicationStatus(cfg);
  for(const changes of [{applicationStatusDirectory:base},{applicationStatusDirectory:resolve(base,'private','reader')},
    {applicationStatusDirectory:resolve(base,'state','reader')},{applicationStatusGid:undefined},{applicationStatusGid:0},{executionMode:'wsl'}])assert.throws(()=>validateApplicationStatus({...cfg,...changes}));
});

function permissionTree({parent={}}={}) {
  const directory=resolve('synthetic-status-ancestor','reader'),parentPath=dirname(directory),seen=[];
  const stat=(changes={})=>({uid:0,gid:0,mode:0o755,isDirectory:()=>true,isSymbolicLink:()=>false,...changes});
  const dependencies={lstat:path=>{seen.push(path);return path===directory?stat({gid:65530,mode:0o750}):path===parentPath?stat(parent):stat();},realpath:path=>path};
  return {directory,parentPath,seen,dependencies};
}

test('root700 ancestor refuses publication despite a correctly readable750 leaf',()=>{
  const f=permissionTree({parent:{uid:0,gid:0,mode:0o700}});
  assert.throws(()=>verifyApplicationStatusDirectory(f.directory,65530,f.dependencies),/cannot be traversed/);
  assert.deepEqual(f.seen,[f.directory,f.parentPath]);
});
test('clear-groups reader traverses755 other-class and same-gid execute ancestors',()=>{
  for(const parent of [{gid:0,mode:0o755},{gid:65530,mode:0o710},{gid:0,mode:0o701}]) {
    const f=permissionTree({parent});assert.doesNotThrow(()=>verifyApplicationStatusDirectory(f.directory,65530,f.dependencies));
    assert.equal(f.seen.at(-1),resolve('/')); // Every ancestor through the filesystem root is checked.
  }
});
test('matching gid cannot borrow other execute and a cleared supplementary group cannot grant access',()=>{
  for(const parent of [{gid:65530,mode:0o701},{gid:1234,mode:0o750}]) {
    const f=permissionTree({parent});assert.throws(()=>verifyApplicationStatusDirectory(f.directory,65530,f.dependencies),/cannot be traversed/);
  }
});
test('reader traversal does not relax root ownership, nonwrite or exact leaf permissions',()=>{
  for(const parent of [{uid:65530,gid:65530,mode:0o750},{gid:65530,mode:0o770},{gid:0,mode:0o757}]) {
    const f=permissionTree({parent});assert.throws(()=>verifyApplicationStatusDirectory(f.directory,65530,f.dependencies),/writable or redirected/);
  }
  for(const leaf of [{gid:1234,mode:0o750},{gid:65530,mode:0o751}]) {
    const f=permissionTree(),lstat=f.dependencies.lstat;
    f.dependencies.lstat=path=>path===f.directory?{...lstat(path),...leaf}:lstat(path);
    assert.throws(()=>verifyApplicationStatusDirectory(f.directory,65530,f.dependencies));
  }
});
