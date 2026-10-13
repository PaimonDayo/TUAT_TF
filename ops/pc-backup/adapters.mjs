import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { S3Client,PutObjectCommand,HeadObjectCommand,GetObjectCommand,ListObjectsV2Command } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { readPrivateFile,BACKUP_LIMITS,backupDockerSocket } from './config.mjs';
import { sha256 } from './archive.mjs';
import { decryptBackup,verifyRecovery } from '../laptop/backup-backend.mjs';

export {BACKUP_LIMITS};
export const STORAGE_LIMITS=Object.freeze({maxKeys:1000,listPageBytes:BACKUP_LIMITS.metadataBytes,controlResponseBytes:BACKUP_LIMITS.pushBytes});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const bytes=value=>Number.isSafeInteger(value)&&value>=0;
const etag=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\r\n\0]/.test(value);
const utc=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value?Date.parse(value):NaN;
function add(a,b) {const result=a+b;if(!bytes(result))throw Error('Backup budget overflow');return result;}
function multiply(a,b) {const result=a*b;if(!bytes(result))throw Error('Backup budget overflow');return result;}
function inventoryLimit(value) {
  if(!Number.isInteger(value)||value<1||value>BACKUP_LIMITS.inventory)throw Error('Invalid backup inventory limit');
  return value;
}
const pages=limit=>Math.ceil(inventoryLimit(limit)/STORAGE_LIMITS.maxKeys)+1;
export function createCycleBudget({maxRequestCount,maxTransferBytes}={}) {
  if(!bytes(maxRequestCount)||maxRequestCount<1||!bytes(maxTransferBytes))throw Error('Invalid backup cycle budget');
  let requestCount=0,transferBytes=0;
  return Object.freeze({
    reserve(requests,transfer) {
      if(!bytes(requests)||!bytes(transfer))throw Error('Invalid backup budget reservation');
      const nextRequests=add(requestCount,requests),nextTransfer=add(transferBytes,transfer);
      if(nextRequests>maxRequestCount||nextTransfer>maxTransferBytes)throw Error('Backup cycle budget exhausted');
      requestCount=nextRequests;transferBytes=nextTransfer;
    },
    snapshot:()=>({requestCount,transferBytes})
  });
}
function receiptPairBytes(receipt) {
  if(receipt?.state!=='verified'||receipt.remoteState!=='verified'||!bytes(receipt.dumpBytes)||receipt.dumpBytes<36
    ||!bytes(receipt.recoveryBytes)||receipt.recoveryBytes<36)throw Error('Remote receipt unverified');
  return add(receipt.dumpBytes,receipt.recoveryBytes);
}
export function inventoryBounds({inventoryLimit:limit,receipts,maxPairBytes}={}) {
  const pageLimit=pages(limit);
  if(!Array.isArray(receipts)||receipts.length>limit||!bytes(maxPairBytes)||maxPairBytes<72)throw Error('Invalid backup inventory bound');
  let pairBytes=0;
  for(const receipt of receipts) {const size=receiptPairBytes(receipt);if(size>maxPairBytes)throw Error('Receipt exceeds pair bound');pairBytes=add(pairBytes,size);}
  const controlRequests=add(multiply(8,receipts.length),10),requestCount=add(multiply(2,pageLimit),controlRequests);
  const ciphertext=add(multiply(2,pairBytes),multiply(3,maxPairBytes));
  return {requestCount,transferBytes:add(ciphertext,add(multiply(2*pageLimit,STORAGE_LIMITS.listPageBytes),multiply(controlRequests,STORAGE_LIMITS.controlResponseBytes)))};
}

async function boundedBody(body,{maximumBytes,expectedBytes,signal,timeoutMilliseconds=30_000}) {
  if(!body?.[Symbol.asyncIterator]||!bytes(maximumBytes))throw Error('Invalid backup readback');
  let deadline,rejectAbort,completed=false;
  const close=()=>{try {body.destroy?.();} catch {/* Close best effort after abort. */}try {Promise.resolve(body.cancel?.()).catch(()=>{});} catch {/* Locked web stream. */}};
  const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
  const abort=()=>{close();rejectAbort(Error('Backup readback aborted'));};
  if(signal?.aborted) abort();else signal?.addEventListener('abort',abort,{once:true});
  deadline=setTimeout(abort,timeoutMilliseconds);
  const read=(async()=>{
    const chunks=[];let count=0;
    for await(const chunk of body) {if(!Buffer.isBuffer(chunk)&&!(chunk instanceof Uint8Array))throw Error('Invalid backup stream');count+=chunk.length;if(count>maximumBytes) throw Error('Oversized backup readback');chunks.push(chunk);}
    if(expectedBytes!==undefined&&count!==expectedBytes) throw Error('Incomplete backup readback');
    return Buffer.concat(chunks);
  })();
  try {const bytes=await Promise.race([read,aborted]);completed=true;return bytes;}
  finally {clearTimeout(deadline);signal?.removeEventListener('abort',abort);if(!completed) close();}
}
export async function boundedReadback(body,{expectedBytes,signal,timeoutMilliseconds=30_000}) {
  if(!Number.isSafeInteger(expectedBytes)||expectedBytes<36)throw Error('Invalid backup readback');
  return boundedBody(body,{maximumBytes:expectedBytes,expectedBytes,signal,timeoutMilliseconds});
}

// Cap control XML before SDK deserialization, including errors. Successful ciphertext
// bodies remain streaming and are bounded by the exact receipt/upload size below.
function boundedStorageHandler(handler) {
  return {
    metadata:handler.metadata,
    async handle(request,options) {
      const result=await handler.handle(request,options),response=result.response;
      try {
        const headerBytes=Buffer.byteLength(JSON.stringify(response.headers??{}));
        const list=request.query?.['list-type']==='2',control=list&&response.statusCode<300?STORAGE_LIMITS.listPageBytes:STORAGE_LIMITS.controlResponseBytes;
        if(headerBytes>control)throw Error('Backup storage headers exceed bound');
        if(list||request.method!=='GET'||response.statusCode>=300) {
          if(response.body) {
            const body=await boundedBody(response.body,{maximumBytes:control-headerBytes,signal:options?.abortSignal});
            response.body=Readable.from([body]);
          }
        }
        return result;
      } catch {response.body?.destroy?.();throw Error('Backup storage response exceeds bound');}
    },
    destroy:()=>handler.destroy?.(),
    updateHttpClientConfig:(...args)=>handler.updateHttpClientConfig?.(...args),
    httpHandlerConfigs:()=>handler.httpHandlerConfigs?.()??{}
  };
}

function flatReceipt(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)
    throw Error('Remote receipt metadata unverified');
  const result={},descriptors=Object.getOwnPropertyDescriptors(value);
  const fields=['version','state','receiptId','instanceId','generation','startedAt','databaseSystemIdentifier','targetFingerprint','storageScopeId','archiveKeyId',
    'capturedAt','verifiedAt','dumpKey','recoveryKey','dumpSha256','recoverySha256','dumpEtag','recoveryEtag','dumpBytes','recoveryBytes','localState','remoteState','localBytes','remoteBytes'];
  if(Object.keys(descriptors).length>fields.length)throw Error('Remote receipt metadata unverified');
  for(const [key,descriptor] of Object.entries(descriptors)) {
    if(!fields.includes(key)||!Object.hasOwn(descriptor,'value')||descriptor.value!==null&&!['string','number','boolean'].includes(typeof descriptor.value)
      ||typeof descriptor.value==='string'&&descriptor.value.length>2048)throw Error('Remote receipt metadata unverified');
    result[key]=descriptor.value;
  }
  return result;
}

// Explicit argument transport only: no shell, SSH, sudo, target discovery or old supervisor.
export function createAdapters(config,env,{execute=promisify(execFile),readBinary=readFileSync,createStorage=options=>new S3Client(options),createHttpHandler=()=>new NodeHttpHandler()}={}) {
  let commandUncertain=false;
  const native=config.executionMode==='linux';
  const dockerSocket=backupDockerSocket(config);
  const commandEnvironment=native?{LANG:'C.UTF-8',DOCKER_CONFIG:'/nonexistent'}:Object.fromEntries(['SystemRoot','WINDIR','SystemDrive','USERPROFILE','LOCALAPPDATA','APPDATA','TEMP','TMP','PROGRAMDATA']
    .filter(name=>typeof process.env[name]==='string').map(name=>[name,process.env[name]]));
  const run=async(args,{signal,timeout=10_000,maxBuffer=BACKUP_LIMITS.pushBytes}={})=>{
    if(commandUncertain) throw Error('Previous command outcome requires reconciliation');
    if(native) {
      if(args[0]!==config.dockerExecutable||sha256(readBinary(config.dockerExecutable))!==config.dockerSha256) throw Error('Native Docker command pin changed');
    } else if(sha256(readBinary(config.wslExecutable))!==config.wslSha256) throw Error('Command pin changed');
    try {
      const {stdout}=await execute(native?config.dockerExecutable:config.wslExecutable,native?args.slice(1):['--distribution',config.wslDistribution,'--user',config.wslUser,'--exec',...args],
        {encoding:'buffer',windowsHide:true,timeout,maxBuffer,signal,env:commandEnvironment});
      return stdout;
    } catch {commandUncertain=true;throw Error('Backup command outcome unverified');}
  };
  const docker=(args,options)=>run([config.dockerExecutable,'--host',dockerSocket,...args],options);
  const sql=async(statement,signal)=>String(await docker(['exec',config.target.containerId,config.psqlExecutable,'-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',config.target.databaseName,'-c',statement],{signal,maxBuffer:BACKUP_LIMITS.sqlBytes,timeout:30_000})).trim();
  let client;
  const storage=()=>client??=createStorage({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},maxAttempts:1,
    // Pin every shared-config provider used by this installed S3 runtime. R2
    // never reads AWS profiles or falls back to ambient credentials.
    defaultsMode:'standard',retryMode:'standard',authSchemePreference:['aws.auth#sigv4'],disableS3ExpressSessionAuth:true,
    sigv4aSigningRegionSet:[],useArnRegion:false,useDualstackEndpoint:false,useFipsEndpoint:false,userAgentAppId:'tuat-pc-backup',
    credentialDefaultProvider:()=>async()=>{throw Error('Dedicated backup storage credentials required');},
    requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',requestHandler:boundedStorageHandler(createHttpHandler())});
  const request=async(command,signal,ms)=>{
    try {return await storage().send(command,{abortSignal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(ms)])});}
    catch {throw Error('Backup storage operation unverified');}
  };
  const prefix=`ops/pc-backend/${config.instanceId}/backups/`;
  function pairKeys(dumpKey,recoveryKey,capturedAt) {
    if(typeof dumpKey!=='string'||!dumpKey.startsWith(prefix)||recoveryKey!==dumpKey.replace('.dump.enc','.recovery.json.enc'))throw Error('Remote backup keys unverified');
    const match=dumpKey.slice(prefix.length).match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.dump\.enc$/);
    const iso=match?`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`:null;
    if(!iso||!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString()!==iso||capturedAt!==undefined&&capturedAt!==iso)throw Error('Remote backup keys unverified');
  }
  const scope=()=>({
    targetFingerprint:sha256(JSON.stringify(['containerId','containerImageId','containerName',...(native?['ownerLabel','generationLabel']:['composeProject','composeService']),'dataMountSource','databaseName','databaseSystemIdentifier'].map(key=>[key,config.target[key]]))),
    storageScopeId:sha256(JSON.stringify({account:env.R2_ACCOUNT_ID,bucket:env.R2_BUCKET_NAME})),archiveKeyId:sha256(Buffer.from(env.PC_BACKUP_ENCRYPTION_KEY,'hex'))
  });
  function objectMetadata(object) {
    const {key,size,identity}={key:object?.key,size:object?.bytes,identity:object?.etag};
    if(typeof key!=='string'||!key.startsWith(prefix)||key.length===prefix.length||Buffer.byteLength(key)>1024||/[\r\n\0]/.test(key)||!bytes(size)||!etag(identity))throw Error('Remote inventory object unverified');
    return {key,bytes:size,etag:identity};
  }
  const reserve=(budget,count,transfer)=>{if(typeof budget?.reserve!=='function')throw Error('Backup inventory budget required');budget.reserve(count,transfer);};
  async function readRemote({key,size,digest,identity,recovery},signal) {
    const head=await request(new HeadObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:key}),signal,10_000);
    if(head.ContentLength!==size||head.Metadata?.sha256!==digest||head.ETag!==identity||!etag(head.ETag)
      ||recovery!==undefined&&head.Metadata?.recovery!==recovery)throw Error('Remote encrypted pair verification failed');
    const downloaded=await request(new GetObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:key,IfMatch:identity}),signal,30_000);
    if(downloaded.ContentLength!==size||downloaded.ETag!==identity||downloaded.Metadata?.sha256!==digest
      ||recovery!==undefined&&downloaded.Metadata?.recovery!==recovery) {downloaded.Body?.destroy?.();throw Error('Remote backup size or identity mismatch');}
    const actual=await boundedReadback(downloaded.Body,{expectedBytes:size,signal});
    if(sha256(actual)!==digest)throw Error('Remote backup readback mismatch');
  }
  return {
    async probe({signal}) {
      const digest=native?sha256(readBinary(config.dockerExecutable)):String(await run(['/usr/bin/sha256sum',config.dockerExecutable],{signal})).trim().split(/\s+/)[0];
      if(digest!==config.dockerSha256) throw Error('Docker command pin changed');
      const format='{{.Id}}|{{.Image}}|{{.Name}}|{{.State.Running}}|'+(native?'{{index .Config.Labels "tuat.owner"}}|{{index .Config.Labels "tuat.generation"}}':'{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}')+'|{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Source}}{{end}}{{end}}';
      const fields=String(await docker(['inspect','--format',format,config.target.containerId],{signal})).trim().split('|');
      const expected=[config.target.containerId,config.target.containerImageId,`/${config.target.containerName}`,'true',...(native?[config.target.ownerLabel,config.target.generationLabel]:[config.target.composeProject,'db']),config.target.dataMountSource];
      if(fields.length!==expected.length||fields.some((value,index)=>value!==expected[index])) throw Error('Database container ownership mismatch');
      const identity=await sql("SELECT current_database() || '|' || system_identifier::text FROM pg_control_system();",signal);
      if(identity!==`${config.target.databaseName}|${config.target.databaseSystemIdentifier}`) throw Error('Database system identity mismatch');
      return {...config.target};
    },
    async dump({signal}) {
      return docker(['exec',config.target.containerId,config.pgDumpExecutable,'-U','supabase_admin','-d',config.target.databaseName,'--format=custom','--schema=public','--schema=auth','--schema=storage','--schema=pc_ops','--schema=extensions'],{signal,maxBuffer:BACKUP_LIMITS.dumpBytes,timeout:120_000});
    },
    async recovery({signal}) {
      const vault=JSON.parse(await sql("SELECT COALESCE(json_agg(json_build_object('name',name,'description',description,'secret',decrypted_secret) ORDER BY name),'[]') FROM vault.decrypted_secrets;",signal));
      const installed=await sql("SELECT to_regclass('cron.job') IS NOT NULL;",signal)==='t';
      const jobs=installed?JSON.parse(await sql("SELECT COALESCE(json_agg(to_jsonb(j) ORDER BY jobid),'[]') FROM cron.job j;",signal)):[];
      const pushEnv=config.pushEnvironmentFile===null?null:readPrivateFile(config.pushEnvironmentFile,BACKUP_LIMITS.pushBytes).toString('utf8');
      return {version:1,capturedAt:new Date().toISOString(),vault,pushEnv,cron:{installed,jobs}};
    },
    async listInventory({prefix:requestedPrefix,inventoryLimit:limit,budget,signal}) {
      const pageLimit=pages(limit),objects=[],keys=new Set(),tokens=new Set();let token,previousKey;
      if(requestedPrefix!==prefix)throw Error('Exact backup prefix required');
      for(let page=0;page<pageLimit;page++) {
        const maxKeys=Math.min(STORAGE_LIMITS.maxKeys,limit-objects.length+1);
        reserve(budget,1,STORAGE_LIMITS.listPageBytes);
        const result=await request(new ListObjectsV2Command({Bucket:env.R2_BUCKET_NAME,Prefix:prefix,MaxKeys:maxKeys,...(token?{ContinuationToken:token}:{})}),signal,30_000);
        const contents=result.Contents??[];
        if(!Array.isArray(contents)||contents.length>maxKeys||typeof result.IsTruncated!=='boolean'
          ||result.KeyCount!==undefined&&result.KeyCount!==contents.length||result.CommonPrefixes?.length
          ||result.Prefix!==undefined&&result.Prefix!==prefix||result.Delimiter)throw Error('Remote inventory incomplete');
        for(const object of contents) {
          const item=objectMetadata({key:object.Key,bytes:object.Size,etag:object.ETag});
          if(keys.has(item.key)||previousKey!==undefined&&Buffer.compare(Buffer.from(item.key),Buffer.from(previousKey))<=0)throw Error('Remote inventory duplicate or unordered');
          keys.add(item.key);previousKey=item.key;objects.push(item);
          if(objects.length>limit)throw Error('Remote inventory exceeds limit');
        }
        if(!result.IsTruncated) {
          if(result.NextContinuationToken)throw Error('Remote inventory completion unverified');
          return {complete:true,objects};
        }
        const next=result.NextContinuationToken;
        if(!contents.length||typeof next!=='string'||!next||Buffer.byteLength(next)>2048||/[\r\n\0]/.test(next)||tokens.has(next))throw Error('Remote inventory pagination unverified');
        tokens.add(next);token=next;
      }
      throw Error('Remote inventory pagination exceeds bound');
    },
    async verifyInventory({snapshot,receipts,budget,signal}) {
      const limit=config.capacity?.inventoryLimit??BACKUP_LIMITS.inventory;
      if(snapshot?.complete!==true||!Array.isArray(snapshot.objects)||snapshot.objects.length>inventoryLimit(limit)
        ||!Array.isArray(receipts)||receipts.length>limit)throw Error('Complete remote inventory required');
      const objects=new Map(),ids=new Set(),receiptKeys=new Set(),verified=[],expectedScope=scope();let pairBytes=0;
      for(const object of snapshot.objects) {const item=objectMetadata(object);if(objects.has(item.key))throw Error('Remote inventory duplicate');objects.set(item.key,item);}
      for(const raw of receipts) {
        const receipt=flatReceipt(raw),size=receiptPairBytes(receipt);
        const started=utc(receipt.startedAt),captured=utc(receipt.capturedAt),confirmed=utc(receipt.verifiedAt);
        if(receipt.version!==1||!uuid(receipt.receiptId)||!uuid(receipt.generation)||receipt.instanceId!==config.instanceId
          ||receipt.databaseSystemIdentifier!==config.target.databaseSystemIdentifier||Object.keys(expectedScope).some(key=>receipt[key]!==expectedScope[key])
          ||![started,captured,confirmed].every(Number.isFinite)||captured<started||confirmed<captured
          ||!['complete','absent'].includes(receipt.localState)||receipt.localBytes!==(receipt.localState==='complete'?size:0)||receipt.remoteBytes!==size
          ||!hash(receipt.dumpSha256)||!hash(receipt.recoverySha256)||!etag(receipt.dumpEtag)||!etag(receipt.recoveryEtag)
          ||ids.has(receipt.receiptId)||receiptKeys.has(receipt.dumpKey)||receiptKeys.has(receipt.recoveryKey)
          ||config.capacity?.maxPairBytes!==undefined&&size>config.capacity.maxPairBytes)throw Error('Remote receipt scope or identity unverified');
        pairKeys(receipt.dumpKey,receipt.recoveryKey,receipt.capturedAt);
        const dump=objects.get(receipt.dumpKey),recovery=objects.get(receipt.recoveryKey);
        if(dump?.bytes!==receipt.dumpBytes||dump?.etag!==receipt.dumpEtag||recovery?.bytes!==receipt.recoveryBytes||recovery?.etag!==receipt.recoveryEtag)throw Error('Remote receipt missing or changed');
        ids.add(receipt.receiptId);receiptKeys.add(receipt.dumpKey);receiptKeys.add(receipt.recoveryKey);pairBytes=add(pairBytes,size);verified.push(receipt);
      }
      // Reserve every HEAD/GET before the first readback. Partial verification never
      // produces any verifiedReceiptIds, and failure consumes the allowance.
      reserve(budget,multiply(4,verified.length),add(pairBytes,multiply(4*verified.length,STORAGE_LIMITS.controlResponseBytes)));
      for(const receipt of verified) {
        await readRemote({key:receipt.dumpKey,size:receipt.dumpBytes,digest:receipt.dumpSha256,identity:receipt.dumpEtag,recovery:receipt.recoveryKey},signal);
        await readRemote({key:receipt.recoveryKey,size:receipt.recoveryBytes,digest:receipt.recoverySha256,identity:receipt.recoveryEtag},signal);
      }
      return {...snapshot,verifiedReceiptIds:verified.map(receipt=>receipt.receiptId)};
    },
    async uploadAndVerify(pair,{signal,budget}={}) {
      pairKeys(pair.key,pair.recoveryKey);
      if(!Buffer.isBuffer(pair.bytes)||!Buffer.isBuffer(pair.recoveryBytes)||pair.bytes.length<36||pair.recoveryBytes.length<36
        ||sha256(pair.bytes)!==pair.sha256||sha256(pair.recoveryBytes)!==pair.recoverySha256)throw Error('Encrypted pair unverified');
      const pairBytes=add(pair.bytes.length,pair.recoveryBytes.length);
      if(config.capacity?.maxPairBytes!==undefined&&pairBytes>config.capacity.maxPairBytes)throw Error('Encrypted pair exceeds bound');
      const dump=decryptBackup(pair.bytes,env.PC_BACKUP_ENCRYPTION_KEY);
      verifyRecovery(decryptBackup(pair.recoveryBytes,env.PC_BACKUP_ENCRYPTION_KEY),dump,config.instanceId);
      if(budget)reserve(budget,6,add(multiply(2,pairBytes),multiply(6,STORAGE_LIMITS.controlResponseBytes)));
      const bucket=env.R2_BUCKET_NAME;
      const etags=[];
      for(const [key,bytes,hash,recovery] of [[pair.key,pair.bytes,pair.sha256,pair.recoveryKey],[pair.recoveryKey,pair.recoveryBytes,pair.recoverySha256,null]]) {
        await request(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:'application/octet-stream',IfNoneMatch:'*',Metadata:{sha256:hash,...(recovery?{recovery}:{})}}),signal,30_000);
        const head=await request(new HeadObjectCommand({Bucket:bucket,Key:key}),signal,10_000);
        if(head.ContentLength!==bytes.length||head.Metadata?.sha256!==hash||typeof head.ETag!=='string'||!head.ETag||head.ETag.length>256||/[\r\n\0]/.test(head.ETag)) throw Error('Remote encrypted pair verification failed');
        const downloaded=await request(new GetObjectCommand({Bucket:bucket,Key:key,IfMatch:head.ETag}),signal,30_000);
        // Keep readback bounded by the exact uploaded ciphertext size, including streamed bodies.
        if(downloaded.ContentLength!==bytes.length||downloaded.ETag!==head.ETag) {downloaded.Body?.destroy?.();throw Error('Remote backup size or identity mismatch');}
        const actual=await boundedReadback(downloaded.Body,{expectedBytes:bytes.length,signal});
        if(actual.length!==bytes.length||sha256(actual)!==hash||downloaded.Metadata?.sha256!==hash) throw Error('Remote backup readback mismatch');
        etags.push(head.ETag);
      }
      return {verified:true,dumpEtag:etags[0],recoveryEtag:etags[1]};
    },
    isDrained(){return !commandUncertain;},
    close(){client?.destroy();}
  };
}
