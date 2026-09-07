// Always load the dedicated local configuration. Never accept a cloud URL.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
const local=parseEnv(readFileSync(resolve(import.meta.dirname,'../../.contingency/local-app.env'),'utf8'));
if(local.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:8000')throw new Error('Only the dedicated local Supabase can be tested');
Object.assign(process.env,local);
import {createClient} from '@supabase/supabase-js';import {randomUUID,randomBytes} from 'node:crypto';import assert from 'node:assert/strict';
const opts={auth:{persistSession:false,autoRefreshToken:false}},url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,opts),member=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,opts);
const check=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
const anonymous = createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,opts);
const anonProfiles = await anonymous.from('profiles').select('id').limit(1);
assert(anonProfiles.error || anonProfiles.data.length === 0, 'Anonymous profile access must be denied');
const {createDecipheriv} = await import('node:crypto');
const connections=check(await admin.from('google_drive_connections').select('refresh_token_encrypted'));
for(const row of connections){
 const [iv,tag,ciphertext]=row.refresh_token_encrypted.split('.');
 const decipher=createDecipheriv('aes-256-gcm',Buffer.from(local.GOOGLE_TOKEN_ENCRYPTION_KEY,'hex'),Buffer.from(iv,'base64url'));
 decipher.setAuthTag(Buffer.from(tag,'base64url'));
 assert(Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64url')),decipher.final()]).length>0);
}
console.log(`PASS: anonymous access denied; ${connections.length} existing Google connection tokens decrypted without displaying them`);
const comp='validation-'+randomUUID(),name='検証-'+randomUUID();let uid;
try{
 const email=`codex-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url');uid=check(await admin.auth.admin.createUser({email,password,email_confirm:true})).user.id;
 check(await admin.from('profiles').update({display_name:'一時検証',status:'graduated'}).eq('id',uid));check(await member.auth.signInWithPassword({email,password}));
 assert.equal(check(await member.rpc('can_manage_system')),false);
 assert((await member.from('competition_events').insert({name,sort_order:999})).error);
 assert.equal(check(await member.from('competition_events').update({name}).eq('name','100m').select('name')).length,0);
 assert.equal(check(await member.from('competition_events').delete().eq('name','100m').select('name')).length,0);
 check(await admin.from('competitions').insert({id:comp,name:'非表示の検証',starts_on:'2026-09-21'}));
 const batch=check(await member.from('competition_goals').upsert(['100m','200m'].map(event=>({competition_id:comp,user_id:uid,event,target:event+'目標'})),{onConflict:'competition_id,user_id,event'}).select('id,event,target'));
 assert.equal(batch.length,2);
 const unknown=await member.from('competition_goals').insert({competition_id:comp,user_id:uid,event:name,target:'未登録種目'});assert(unknown.error);
 console.log('PASS: non-admin cannot add/rename/delete catalog; two goals saved in one request; unknown event rejected');
}finally{
 check(await admin.from('competitions').delete().eq('id',comp));
 if(uid)check(await admin.auth.admin.deleteUser(uid));
 console.log('Temporary validation data cleaned up; no admin permission granted');
}
