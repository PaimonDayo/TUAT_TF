// No startup, discovery, provider credentials or production transport.
// The caller owns a freshly created, isolated tuat_rls_review PostgreSQL fixture.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const last = output => output.trim().split(/\r?\n/).at(-1);
const sleep = milliseconds => new Promise(resolve=>setTimeout(resolve,milliseconds));
export async function runRaces({sql}) {
  if (typeof sql!=='function') throw Error('Owned synthetic SQL transport required');
  await sql(`DO $$ BEGIN IF current_database()<>'tuat_rls_review' OR EXISTS(SELECT 1 FROM public.profiles WHERE email !~ '@[^@]+\\.invalid$') THEN RAISE EXCEPTION 'Fresh synthetic database required'; END IF; END $$;`);
  const id=randomUUID(),note=randomUUID(),article=randomUUID(),image=randomUUID(),upload=randomUUID();
  const old=`${id}/old.webp`,next=`${id}/next.webp`,winner=`${id}/winner.webp`,unknown=`${id}/unknown.webp`;
  const notePath=`${article}/${upload}.webp`,suffix=id.slice(0,8);
  const auth=`SET LOCAL ROLE authenticated; SELECT set_config('request.headers','{}',true); SELECT set_config('request.jwt.claims','${JSON.stringify({role:'authenticated',sub:id,email:`image-race-${id}@example.invalid`})}',true);`;
  const service=`SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',false);`;
  const start=statement=>sql(statement).then(output=>({ok:true,output}),error=>({ok:false,error}));
  async function waitFor(name,event) {
    const deadline=Date.now()+15000;
    for (;;) {
      if(last(await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='${event}';`))==='1') return;
      if(Date.now()>deadline) throw Error('Synthetic race did not reach its required lock boundary');
      await sleep(50);
    }
  }
  async function orderedRace(first,second,{rejection=false}={}) {
    const aName=`pc-image-a-${suffix}`,bName=`pc-image-b-${suffix}`;
    const a=start(`SET application_name='${aName}'; BEGIN; ${auth} ${first}; SELECT pg_sleep(5); COMMIT;`);
    await waitFor(aName,'Timeout');
    const b=start(`SET application_name='${bName}'; BEGIN; ${auth} ${second}; COMMIT;`);
    await waitFor(bName,'Lock');
    const aResult=await a,bResult=await b;
    assert.equal(aResult.ok,true,'First synthetic transaction must commit');
    assert.equal(bResult.ok,!rejection,'Second transaction must observe the barrier');
    if(rejection) assert.match(String(bResult.error),/This image has been retired/);
    return bResult;
  }
  let passed=0;
  try {
    await sql(`${service}
      INSERT INTO auth.users(id,email) VALUES('${id}','image-race-${id}@example.invalid');
      INSERT INTO public.profiles(id,email,display_name,approved,status,avatar_url) VALUES('${id}','image-race-${id}@example.invalid','Synthetic image race',true,'active','${old}') ON CONFLICT(id) DO UPDATE SET avatar_url=EXCLUDED.avatar_url,approved=true,status='active';
      INSERT INTO public.login_email_allowlist(email,created_by) VALUES('image-race-${id}@example.invalid','${id}');
      INSERT INTO public.notes(id,author_id,scope,title,body,status,edit_policy) VALUES('${note}','${id}','personal','Synthetic race note','','draft','author');
      INSERT INTO public.note_articles(id,note_id,author_id,title,body) VALUES('${article}','${note}','${id}','Synthetic race article','');
      INSERT INTO public.note_article_images(id,article_id,path,created_by) VALUES('${image}','${article}','${notePath}','${id}');`);

    await orderedRace(`UPDATE public.profiles SET avatar_url=null WHERE id='${id}'`,
      `UPDATE public.profiles SET avatar_url='${old}' WHERE id='${id}'`,{rejection:true});
    assert.equal(last(await sql(`SELECT (avatar_url IS NULL)::text FROM public.profiles WHERE id='${id}';`)),'true');
    const closed=JSON.parse(last(await sql(`SELECT public.claim_confirmed_image_cleanup('avatars','${old}');`)));
    assert.ok(closed.closed_at);assert.ok(Date.parse(closed.delete_after)-Date.parse(closed.closed_at)>=605400000);
    const restoration=await start(`BEGIN;${auth} UPDATE public.profiles SET avatar_url='${old}' WHERE id='${id}';COMMIT;`);
    assert.equal(restoration.ok,false);assert.match(String(restoration.error),/This image has been retired/);passed++;

    await sql(`${service} UPDATE public.profiles SET avatar_url='${next}' WHERE id='${id}';`);
    const cas=await orderedRace(`UPDATE public.profiles SET avatar_url='${winner}' WHERE id='${id}'`,
      `WITH changed AS (UPDATE public.profiles SET avatar_url=null WHERE id='${id}' AND avatar_url='${next}' RETURNING id) SELECT count(*) FROM changed`);
    assert.equal(last(cas.output),'0');
    assert.equal(last(await sql(`SELECT avatar_url FROM public.profiles WHERE id='${id}';`)),winner);
    assert.equal(last(await sql(`SELECT public.claim_confirmed_image_cleanup('avatars','${winner}') IS NULL;`)),'t');passed++;

    // A reread can see no registration while the actual save is still in flight.
    // The durable row lock makes cleanup wait; after commit it must retain the path.
    await sql(`SELECT public.image_cleanup_lock('avatars','${unknown}',false);`);
    const aName=`pc-image-u-${suffix}`,bName=`pc-image-c-${suffix}`;
    const save=start(`SET application_name='${aName}';BEGIN;${auth} UPDATE public.profiles SET avatar_url='${unknown}' WHERE id='${id}';SELECT pg_sleep(5);COMMIT;`);
    await waitFor(aName,'Timeout');
    const claim=start(`SET application_name='${bName}';SELECT public.claim_confirmed_image_cleanup('avatars','${unknown}') IS NULL;`);
    await waitFor(bName,'Lock');
    assert.equal((await save).ok,true);const claimed=await claim;assert.equal(claimed.ok,true);assert.equal(last(claimed.output),'t');
    assert.equal(last(await sql(`SELECT avatar_url FROM public.profiles WHERE id='${id}';`)),unknown);passed++;

    await orderedRace(`DELETE FROM public.note_article_images WHERE id='${image}'`,
      `INSERT INTO public.note_article_images(article_id,path,created_by) VALUES('${article}','${notePath}','${id}')`,{rejection:true});
    assert.equal(last(await sql(`SELECT count(*) FROM public.note_article_images WHERE path='${notePath}';`)),'0');passed++;
    return {passed,realSql:true,syntheticOnly:true,r2Requests:0};
  } finally {
    // This transport can only be used against the caller's fresh owned DB. Remove
    // only this UUID fixture; the caller owns container/volume/network cleanup.
    await sql(`${service} DELETE FROM public.notes WHERE id='${note}'; DELETE FROM public.login_email_allowlist WHERE email='image-race-${id}@example.invalid'; DELETE FROM public.profiles WHERE id='${id}'; DELETE FROM auth.users WHERE id='${id}';
      DELETE FROM public.confirmed_image_retirements WHERE (bucket='avatars' AND path LIKE '${id}/%') OR (bucket='note-images' AND path LIKE '${article}/%');
      DELETE FROM public.note_image_cleanup WHERE path LIKE '${article}/%';`);
  }
}

export function ownedContainerSql(container) {
  if(!/^codex-auth-dbreview-[a-f0-9-]{32,36}$/i.test(container??'')) throw Error('New owner-named synthetic container required');
  return statement=>new Promise((resolvePromise,reject)=>{
    const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','tuat_rls_review'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='',err='';const timer=setTimeout(()=>child.kill(),25000);
    child.stdout.on('data',chunk=>{out+=chunk;if(out.length>65536)child.kill();});
    child.stderr.on('data',chunk=>{err+=chunk;if(err.length>16384)child.kill();});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);if(code===0)resolvePromise(out);else reject(Error(err||'Synthetic SQL transport failed'));});
    child.stdin.end(statement);
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [flag,container]=process.argv.slice(2);
  try {
    if(flag!=='--container'||process.argv.length!==4) throw Error('Explicit owned fixture transport required');
    console.log(JSON.stringify(await runRaces({sql:ownedContainerSql(container)})));
  } catch(error) { console.error(`Synthetic image race failed: ${error.message}`);process.exitCode=1; }
}
