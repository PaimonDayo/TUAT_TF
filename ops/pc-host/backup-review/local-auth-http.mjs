// Native GoTrue/PostgREST in the fresh review DB's unpublished network namespace.
// Tokens/passwords exist only in memory; the caller owns exact cleanup identities.
import assert from 'node:assert/strict';
import { randomBytes,randomUUID,createHmac } from 'node:crypto';

export async function verifyLocalAuth({docker,sql,names,start,pins}) {
  const secret=randomBytes(32).toString('hex'),password=randomBytes(24).toString('hex');
  const key=role=>{
    const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const body=`${encode({alg:'HS256',typ:'JWT'})}.${encode({role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}`;
    return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
  };
  const service=key('service_role');
  // Existing platform role; password stays within this newly owned DB only.
  sql(names.source,`ALTER ROLE authenticator LOGIN PASSWORD '${password}';`);
  start(names.auth,['--network',`container:${names.source}`,'--memory','128m','--read-only','--tmpfs','/tmp',
    '-e','GOTRUE_API_HOST=127.0.0.1','-e','GOTRUE_API_PORT=19031','-e','GOTRUE_DB_DRIVER=postgres',
    '-e','GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:synthetic-backup-local-only@127.0.0.1:5432/tuat_rls_review?search_path=auth',
    '-e','GOTRUE_SITE_URL=https://pc.example.test','-e','API_EXTERNAL_URL=https://pc.example.test/api/pc-supabase/auth/v1',
    '-e','GOTRUE_URI_ALLOW_LIST=https://pc.example.test/auth/callback','-e',`GOTRUE_JWT_SECRET=${secret}`,
    '-e','GOTRUE_JWT_AUD=authenticated','-e','GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated','-e','GOTRUE_JWT_ADMIN_ROLES=service_role',
    '-e','GOTRUE_DISABLE_SIGNUP=true','-e','GOTRUE_EXTERNAL_EMAIL_ENABLED=true','-e','GOTRUE_MAILER_AUTOCONFIRM=true',
    '-e','GOTRUE_EXTERNAL_GOOGLE_ENABLED=false','-e','GOTRUE_LOG_LEVEL=error',pins.auth[1]]);
  const rest='sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c';
  assert.equal(docker(['image','inspect','postgrest/postgrest:v14.12','--format','{{.Id}}']).toString().trim(),rest);
  start(names.storage,['--network',`container:${names.source}`,'--memory','128m','--read-only','--tmpfs','/tmp',
    '-e','PGRST_SERVER_HOST=127.0.0.1','-e','PGRST_SERVER_PORT=19032',
    '-e',`PGRST_DB_URI=postgres://authenticator:${password}@127.0.0.1:5432/tuat_rls_review`,
    '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${secret}`,rest]);
  const request=(port,path,{method='GET',token,body}={})=>{
    const args=['exec','-i',names.source,'curl','--silent','--show-error','--max-time','5','--request',method,'--write-out','\n%{http_code}',
      '--header','Content-Type: application/json','--header','Prefer: return=representation'];
    if(token)args.push('--header',`Authorization: Bearer ${token}`);
    if(body!==undefined)args.push('--data-binary','@-');
    args.push(`http://127.0.0.1:${port}${path}`);
    const raw=docker(args,body===undefined?undefined:Buffer.from(JSON.stringify(body))).toString();
    const at=raw.lastIndexOf('\n');let data;
    try{data=JSON.parse(raw.slice(0,at));}catch{data=null;}
    return {status:Number(raw.slice(at+1).trim()),data};
  };
  let ready=false;
  for(let attempt=0;attempt<40;attempt++) {
    try{if(request(19031,'/health').status===200 && request(19032,'/').status<500){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert(ready,'Native local APIs failed readiness');
  const id=randomUUID(),email=`local-${id}@example.invalid`,memberPassword=randomBytes(24).toString('hex');
  sql(names.source,`INSERT INTO public.login_email_allowlist(email,created_by) VALUES ('${email}','ba611111-0000-4000-8000-000000000001');`);
  const created=request(19031,'/admin/users',{method:'POST',token:service,body:{id,email,password:memberPassword,email_confirm:true}});
  assert.equal(created.status,200,'Local Auth user creation failed'); assert.equal(created.data.id,id);
  sql(names.source,`UPDATE public.profiles SET approved=true WHERE id='${id}';`);
  const login=request(19031,'/token?grant_type=password',{method:'POST',body:{email,password:memberPassword}});
  assert.equal(login.status,200,'Private synthetic login failed');assert.equal(login.data.user.id,id);
  const refreshed=request(19031,'/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:login.data.refresh_token}});
  assert.equal(refreshed.status,200,'Local refresh failed');assert.equal(refreshed.data.user.id,id);
  const token=refreshed.data.access_token;
  assert.equal(request(19031,'/user',{token}).data.id,id);
  const own=request(19032,`/profiles?id=eq.${id}&select=id`,{token});
  assert.equal(own.status,200,'Local member read failed');assert.equal(own.data.length,1);assert.equal(own.data[0].id,id);
  const edited=request(19032,`/profiles?id=eq.${id}`,{method:'PATCH',token,body:{display_name:'Synthetic local login'}});
  assert.equal(edited.status,200,'Local member edit failed');assert.equal(edited.data.length,1);
  const foreignId='ba611111-0000-4000-8000-000000000001';
  assert.equal(sql(names.source,`SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id='${foreignId}');`),'t');
  const foreign=request(19032,`/profiles?id=eq.${foreignId}`,{method:'PATCH',token,body:{display_name:'Must not apply'}});
  assert.equal(foreign.status,200);assert.equal(foreign.data.length,0);
  const invalid=token.slice(0,-2)+(token.endsWith('AA')?'BB':'AA');
  assert.equal(request(19032,'/profiles?select=id',{token:invalid}).status,401);
  return {nativeGoTrue:true,nativePostgrest:true,localSingleIssuer:true,createdUuidPreserved:true,refreshUuidPreserved:true,
    verifiedUser:true,ownRead:true,ownEdit:true,foreignEditDenied:true,invalidSignatureDenied:true,
    googleOAuthProved:false,externalProviderCalls:0,publishedPorts:0};
}
