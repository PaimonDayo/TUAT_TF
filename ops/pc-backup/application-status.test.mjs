import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { applicationStatusMetadata,validateApplicationStatus } from './application-status.mjs';

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
