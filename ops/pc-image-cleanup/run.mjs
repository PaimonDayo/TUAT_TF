// Standalone and off by default. Reads dedicated credentials only on explicit dry-run/apply.
import { readFileSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { privateDirectory } from '../pc-host/release.mjs';
import { validateConfig, captureSnapshot, dryRun, applyCleanup } from './cleanup.mjs';

function writePrivate(file,value) {
  privateDirectory(dirname(file));
  const temporary = `${file}.${randomBytes(12).toString('hex')}.tmp`;
  const descriptor = openSync(temporary,'wx',0o600);
  try { writeFileSync(descriptor,JSON.stringify(value,null,2)); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  renameSync(temporary,file);
}
export function createAdapter(config,env,{ fetchRequest = fetch, removeObject } = {}) {
  for (const name of ['PC_IMAGE_CLEANUP_SERVICE_ROLE_KEY','PC_IMAGE_CLEANUP_R2_ACCESS_KEY_ID','PC_IMAGE_CLEANUP_R2_SECRET_ACCESS_KEY']) {
    if (typeof env[name] !== 'string' || !env[name] || /[\r\n]/.test(env[name])) throw Error('Dedicated cleanup credentials required');
  }
  if (env.PC_IMAGE_CLEANUP_R2_ACCOUNT_ID !== config.r2AccountId || env.PC_IMAGE_CLEANUP_R2_BUCKET !== config.r2Bucket) throw Error('Cleanup object target mismatch');
  const request = async (path,body) => {
    const key = env.PC_IMAGE_CLEANUP_SERVICE_ROLE_KEY;
    const response = await fetchRequest(config.pcUrl + '/rest/v1/' + path,{ method: body === undefined ? 'GET' : 'POST',
      headers: { apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json' },
      ...(body === undefined ? {} : { body:JSON.stringify(body) }),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000) });
    if (!response.ok) throw Error('Cleanup database dependency unavailable');
    const reader = response.body?.getReader(); if (!reader) throw Error('Cleanup database response unavailable');
    let length = 0; const chunks = [];
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.length;
        if (length > 65536) throw Error('Cleanup database response exceeds bound'); chunks.push(Buffer.from(next.value)); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { await reader.cancel().catch(()=>{}); throw Error('Cleanup database response unavailable'); }
  };
  return {
    target:()=>request('rpc/confirmed_image_cleanup_target',{}),
    confirmed:(limit,cutoff)=>request(`confirmed_image_retirements?select=bucket,path,confirmed_at,closed_at,delete_after,deleted_at&confirmed_at=not.is.null&deleted_at=is.null&or=(closed_at.is.null,delete_after.lte.${encodeURIComponent(cutoff)})&order=confirmed_at.asc,bucket.asc,path.asc&limit=${limit}`),
    claim:(bucket,path)=>request('rpc/claim_confirmed_image_cleanup',{p_bucket:bucket,p_path:path}),
    finish:(bucket,path,closed_at)=>request('rpc/finish_confirmed_image_cleanup',{p_bucket:bucket,p_path:path,p_closed_at:closed_at}),
    remove:async key=>{
      if (removeObject) return removeObject(key);
      const { S3Client,DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const client = new S3Client({region:'auto',endpoint:`https://${config.r2AccountId}.r2.cloudflarestorage.com`,
        maxAttempts:1,credentials:{accessKeyId:env.PC_IMAGE_CLEANUP_R2_ACCESS_KEY_ID,secretAccessKey:env.PC_IMAGE_CLEANUP_R2_SECRET_ACCESS_KEY}});
      try { await client.send(new DeleteObjectCommand({Bucket:config.r2Bucket,Key:key}),{abortSignal:AbortSignal.timeout(8000)}); }
      catch { throw Error('Cleanup object deletion outcome unavailable'); }
      finally { client.destroy(); }
    },
  };
}

export async function run(configFile,mode='--check',{adapter: suppliedAdapter,now=()=>Date.now()}={}) {
  if (!['--check','--dry-run','--apply'].includes(mode)) throw Error('Invalid cleanup mode');
  if (!configFile) return {enabled:false,reads:false,writes:false};
  const config=JSON.parse(readFileSync(configFile,'utf8')); validateConfig(config);
  if (!isAbsolute(config.stateDirectory ?? '') || !isAbsolute(config.environmentFile ?? '')) throw Error('Dedicated private cleanup paths required');
  if (mode==='--check') return {enabled:config.enabled,reads:false,writes:false};
  if (mode==='--apply' && !config.enabled) throw Error('Confirmed image cleanup is disabled');
  // Check the private parent before reading credentials or creating state.
  privateDirectory(dirname(config.environmentFile)); privateDirectory(config.stateDirectory);
  const lockFile=resolve(config.stateDirectory,'confirmed-image-cleanup.lock');
  const lock=openSync(lockFile,'wx',0o600);
  try {
    const adapter=suppliedAdapter ?? createAdapter(config,parseEnv(readFileSync(config.environmentFile,'utf8')));
    const snapshotFile=resolve(config.stateDirectory,'confirmed-image-cleanup-snapshot.json');
    const previewFile=resolve(config.stateDirectory,'confirmed-image-cleanup-dry-run.json');
    if (mode==='--dry-run') {
      const snapshot=await captureSnapshot(config,adapter,now()); const preview=dryRun(snapshot);
      writePrivate(snapshotFile,snapshot); writePrivate(previewFile,preview);
      return {dryRun:true,enabled:config.enabled,writes:false,...preview.counts};
    }
    const stored=JSON.parse(readFileSync(snapshotFile,'utf8'));
    const preview=JSON.parse(readFileSync(previewFile,'utf8'));
    if (JSON.stringify(stored)!==JSON.stringify(preview.snapshot)) throw Error('Cleanup snapshot and dry run disagree');
    return {applied:true,...await applyCleanup(config,adapter,preview,{now})};
  } finally { closeSync(lock); unlinkSync(lockFile); }
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [mode='--check',configFile]=process.argv.slice(2);
  try { console.log(JSON.stringify(await run(configFile,mode))); }
  catch { console.error('Confirmed image cleanup stopped; no uncertain references are deleted.'); process.exitCode=1; }
}
