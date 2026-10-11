import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {prepareEncryptedPair,verifyEncryptedPair,prepareSnapshotDirectory,persistEncryptedPair} from './snapshot.mjs';
import {runReviewedCapture} from './run-reviewed.mjs';
import {spawnSync} from 'node:child_process';

test('direct CLI invocation refuses capture and missing proof returns a sanitized error before fetch',async()=>{
  const invoked=spawnSync(process.execPath,[resolve(import.meta.dirname,'run-reviewed.mjs')],{encoding:'utf8'});
  assert.equal(invoked.status,1);
  assert.equal(invoked.stdout,'');
  assert.match(invoked.stderr,/No capture ran/);
  let calls=0;
  await assert.rejects(runReviewedCapture({cloud:{url:'https://secret.example.test',key:'secret-marker'},fetchImpl:async()=>{calls++;}}),error=>{
    assert(!error.message.includes('secret'));return /Read-only capture failed/.test(error.message);
  });
  assert.equal(calls,0);
});

test('snapshot destination inside a Git checkout rejects before directory/bytes creation',()=>{
  const directory=resolve(import.meta.dirname,`synthetic-rejected-${randomUUID()}`);
  assert.equal(existsSync(directory),false);
  assert.throws(()=>prepareSnapshotDirectory(directory),/outside every Git/);
  assert.equal(existsSync(directory),false);
});

const base=process.env.TUAT_RETIREMENT_SYNTHETIC_DIRECTORY;
test('owner-private synthetic files contain ciphertext only and authenticate actual disk readback',
  {skip:!base?'Explicit outside-Git synthetic directory required':false},async()=>{
    assert(isAbsolute(base));
    const directory=resolve(base,`synthetic-retirement-${randomUUID()}`);
    const syntheticMarker=`synthetic-only-${randomUUID()}`;
    const result={snapshot:{synthetic:true,changes:[{data:syntheticMarker}]},
      report:{readOnly:true,retirementReady:false,triggerAndJournalEffectsVerified:false,counts:{unknown:1}}};
    const key=randomBytes(32),pair=prepareEncryptedPair(result,key);
    try {
      prepareSnapshotDirectory(directory);
      const receipt=persistEncryptedPair(directory,pair,key);
      assert.equal(receipt.authenticatedReadback,true);
      assert.equal(receipt.captureId,pair.captureId);
      const names=readdirSync(directory).sort();
      assert.deepEqual(names,[`${pair.captureId}.dry-run.enc`,`${pair.captureId}.snapshot.enc`]);
      const snapshot=readFileSync(resolve(directory,`${pair.captureId}.snapshot.enc`));
      const report=readFileSync(resolve(directory,`${pair.captureId}.dry-run.enc`));
      assert(!snapshot.includes(Buffer.from(syntheticMarker)));
      assert(!report.includes(Buffer.from('unknown')));
      assert.equal(verifyEncryptedPair(snapshot,report,key).snapshot.changes[0].data,syntheticMarker);
      assert.throws(()=>persistEncryptedPair(directory,pair,key),error=>error.code==='EEXIST');
      assert.deepEqual(readFileSync(resolve(directory,`${pair.captureId}.snapshot.enc`)),snapshot);
      const define=(pk,names)=>({properties:Object.fromEntries(names.map(name=>[name,{type:'string',format:'text',...(pk.includes(name)?{description:'<pk/>'}:{})}]))});
      const definitions={failover_changes:define(['id'],['id','table_name','op','pk','row_data','changed','created_at','attempts','last_error']),
        profiles:define(['id'],['id','name'])};
      const row={id:1,table_name:'profiles',op:'UPDATE',pk:{id:'p'},row_data:{id:'p',name:syntheticMarker},changed:['name'],
        attempts:5,created_at:'2026-10-11T00:00:00Z',last_error:syntheticMarker};
      const expected={cloudOrigin:'https://cloud.example.test',pcOrigin:'https://pc.example.test',cloudSettingsHash:'a'.repeat(64),pcSettingsHash:'b'.repeat(64),
        pcRuntimeProofHash:'c'.repeat(64),pcInstanceId:'synthetic',authoritativeSettingsVerified:true,pcRuntimeOwnershipVerified:true};
      const executed=await runReviewedCapture({directory,key,expected,synthetic:true,
        cloud:{url:expected.cloudOrigin,key:'synthetic-cloud-key'},pc:{url:expected.pcOrigin,key:'synthetic-pc-key'},
        fetchImpl:async(url,init)=>{
          assert.equal(init.method,'GET');assert.equal(init.redirect,'error');const request=new URL(url);
          if(request.pathname==='/rest/v1/')return Response.json({definitions});
          if(request.hostname==='cloud.example.test')return request.searchParams.get('select')==='id'
            ?Response.json([{id:1}],{headers:{'content-range':'0-0/1'}}):Response.json([row]);
          assert.equal(request.pathname,'/rest/v1/profiles');assert.equal(request.searchParams.get('id'),'eq."p"');
          return Response.json([{id:'p',name:syntheticMarker}]);
        }});
      assert.equal(executed.authenticatedReadback,true);
      assert.equal(executed.queuedChanges,1);
      assert.equal(executed.counts.pc_matches_final_change,1);
      assert.equal(executed.retirementReady,false);
      assert(!JSON.stringify(executed).includes(syntheticMarker));
      assert(!JSON.stringify(executed).includes('synthetic-cloud-key'));
    } finally {
      // Only this fresh UUID directory and synthetic ciphertext are removed.
      assert.equal(resolve(directory).startsWith(`${resolve(base)}\\`) || resolve(directory).startsWith(`${resolve(base)}/`),true);
      rmSync(directory,{recursive:true,force:true});
      key.fill(0);
    }
  });
