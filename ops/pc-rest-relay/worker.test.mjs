import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRelay } from './worker.mjs';

const app = 'https://tuat-tf.vercel.app';
const relay = 'https://synthetic-relay.workers.dev';
const canonical = 'https://tuat-pc-app.track-app.workers.dev';
const request = (path, method='GET', origin=app, extra={}) => new Request(relay+path, {
  method, headers:{...(origin ? {origin} : {}),...extra},
});

test('retired relay refuses every path/method without inspecting jobs, R2, credentials or body',async()=>{
  let fetched=0,read=0;
  const worker=createRelay(async()=>{fetched++;throw Error('Retired relay must not dispatch');});
  const env={APP_ORIGIN:app,PC_BACKEND_RETIRED:'true'};
  for(const field of ['ENDPOINTS','MONITOR_SECRET','PC_JOBS_HEALTH_KEY'])Object.defineProperty(env,field,{get(){read++;throw Error('Retired input must stay unread');}});
  for(const path of ['/','/rest/v1/records','/jobs-health','/unknown'])for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS','PROPFIND']){
    const response=await worker.fetch(request(path,method),env);
    assert.equal(response.status,503);assert.match(response.headers.get('cache-control'),/no-store/);
    assert.equal(response.headers.get('retry-after'),'60');assert.equal(response.headers.has('x-tuat-backend'),false);
    assert.equal(response.headers.has('location'),false);
    assert.deepEqual(await response.json(),{error:'アプリのURLが変わりました。新しいURLを開いてください。',url:canonical});
  }
  const input=new Request(relay+'/rest/v1/records',{method:'POST',body:'private synthetic body',headers:{origin:app,authorization:'Bearer private-synthetic-jwt'}});
  const response=await worker.fetch(input,env);
  assert.equal(response.status,503);assert.equal(input.bodyUsed,false);assert.equal(await input.text(),'private synthetic body');
  assert.equal(JSON.stringify([...response.headers]).includes('private-synthetic'),false);
  assert.equal(fetched,0);assert.equal(read,0);
});

test('retirement CORS permits only the existing app origin and never advertises cloud fallback',async()=>{
  const worker=createRelay(()=>{throw Error('No dispatch');});
  for(const origin of [app,canonical,'https://evil.invalid',null]){
    const response=await worker.fetch(request('/jobs-health','GET',origin),{APP_ORIGIN:app,PC_BACKEND_RETIRED:'true'});
    assert.equal(response.status,503);assert.equal(response.headers.get('access-control-allow-origin'),origin===app?app:null);
    assert.equal(response.headers.get('vary'),'Origin');assert.equal(response.headers.has('x-tuat-backend'),false);
    if(origin===app)assert.equal(response.headers.get('access-control-expose-headers'),'retry-after');
  }
  const response=await worker.fetch(request('/rest/v1/records'),{PC_BACKEND_RETIRED:'true'});
  assert.equal(response.headers.has('access-control-allow-origin'),false);
});

test('only explicit string true retires the worker; existing origin and preflight behavior remains',async()=>{
  const worker=createRelay(()=>{throw Error('Preflight must not dispatch');});
  for(const flag of [undefined,'false','TRUE',true]){
    const env={APP_ORIGIN:app,PC_BACKEND_RETIRED:flag};
    const response=await worker.fetch(request('/rest/v1/records','OPTIONS',app,{
      'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type',
    }),env);
    assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),app);
    assert.equal(response.headers.get('access-control-max-age'),'600');
    assert.equal((await worker.fetch(request('/rest/v1/records','GET','https://evil.invalid'),env)).status,403);
    assert.equal((await worker.fetch(request('/jobs-health'),env)).status,404);
  }
});

const token='synthetic.'+Buffer.from(JSON.stringify({role:'authenticated',sub:'11111111-1111-4111-8111-111111111111'})).toString('base64url')+'.synthetic';
test('non-retired endpoint absence retains the existing explicit cloud-fallback marker',async()=>{
  let reads=0;
  const response=await createRelay(()=>{throw Error('No endpoint');}).fetch(request('/rest/v1/records','GET',app,{authorization:'Bearer '+token}),{
    APP_ORIGIN:app,PC_BACKEND_RETIRED:'false',PC_BACKEND_INSTANCE_ID:'synthetic',ENDPOINTS:{async get(){reads++;return null;}},
  });
  assert.equal(response.status,503);assert.equal(response.headers.get('x-tuat-backend'),'cloud');assert.equal(reads,1);
});

test('non-retired signed endpoint forwards the original approved REST operation once',async()=>{
  const bridge='synthetic-bridge-secret-at-least-32-bytes',origin='https://synthetic-endpoint.trycloudflare.com',instanceId='synthetic';
  const expiresAt=Date.now()+180000;
  const data={version:1,origin,instanceId,expiresAt,signature:createHmac('sha256',bridge).update(JSON.stringify([1,origin,instanceId,expiresAt])).digest('hex')};
  const calls=[];
  const worker=createRelay(async(url,options)=>{calls.push({url,options});return new Response('{"saved":true}',{status:201});});
  const input=new Request(relay+'/rest/v1/records?select=id',{method:'POST',headers:{origin:app,authorization:'Bearer '+token,'content-type':'application/json'},body:'{"synthetic":true}'});
  const response=await worker.fetch(input,{APP_ORIGIN:app,PC_BACKEND_INSTANCE_ID:instanceId,PC_BACKEND_BRIDGE_KEY:bridge,SUPABASE_ANON_KEY:'synthetic-anon',
    ENDPOINTS:{async get(){return {size:JSON.stringify(data).length,async text(){return JSON.stringify(data);}};}}});
  assert.equal(response.status,201);assert.equal(calls.length,1);assert.equal(calls[0].url,origin+'/backend/rest/v1/records?select=id');
  assert.equal(calls[0].options.headers.get('authorization'),'Bearer '+token);assert.equal(new TextDecoder().decode(calls[0].options.body),'{"synthetic":true}');
});

test('non-retired signed jobs health keeps its private monitor behavior',async()=>{
  const healthKey='synthetic-health-key',checkedAt=Date.now(),expiresAt=checkedAt+180000;
  const value={version:1,healthy:true,checkedAt,expiresAt,signature:createHmac('sha256',healthKey).update(JSON.stringify([1,checkedAt,true,expiresAt])).digest('hex')};
  const response=await createRelay(()=>{throw Error('Health must not fetch');}).fetch(new Request(relay+'/jobs-health',{headers:{authorization:'Bearer synthetic-monitor'}}),{
    PC_BACKEND_RETIRED:'false',MONITOR_SECRET:'synthetic-monitor',PC_JOBS_HEALTH_KEY:healthKey,PC_BACKEND_INSTANCE_ID:'synthetic',
    ENDPOINTS:{async get(){return {size:JSON.stringify(value).length,async json(){return value;}};}},
  });
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
});
