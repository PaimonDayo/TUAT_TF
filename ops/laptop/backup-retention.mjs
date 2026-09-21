import { ListObjectsV2Command, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { directory, readConfig, r2Client, writePrivate } from './backend-files.mjs';
import { decryptBackup, downloadRecovery } from './backup-backend.mjs';

const DAY = 86400000;
const pattern = /^ops\/pc-backend\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/backups\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.(dump|recovery\.json)\.enc$/;
export function planRetention(objects, now = Date.now()) {
  const groups = new Map();
  const untouched = [];
  for (const object of objects) {
    const match = object.key.match(pattern);
    if (!match) { untouched.push(object); continue; }
    const [, instance, stamp, kind] = match;
    const iso = stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
    const time = Date.parse(iso);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== iso || time > now) { untouched.push(object); continue; }
    const id = `${instance}/${stamp}`;
    const group = groups.get(id) ?? { instance, time, objects: [] };
    group.objects.push(object);
    if (kind === 'dump') group.dump = object;
    groups.set(id, group);
  }
  const byInstance = new Map();
  for (const group of groups.values()) {
    if (!group.dump) { untouched.push(...group.objects); continue; }
    const items = byInstance.get(group.instance) ?? [];
    items.push(group); byInstance.set(group.instance, items);
  }
  const keep = [], remove = [], newest = [];
  for (const items of byInstance.values()) {
    items.sort((a, b) => b.time - a.time);
    newest.push(items[0].dump);
    const days = new Set();
    for (const [index, group] of items.entries()) {
      const day = new Date(group.time + 9 * 3600000).toISOString().slice(0, 10);
      const recent = group.time >= now - DAY;
      const daily = group.time >= now - 30 * DAY && !days.has(day);
      // Keep the last recoverable generation of a retired PC, too.
      const preserve = index === 0 || recent || daily;
      if (preserve) { keep.push(...group.objects); days.add(day); }
      else remove.push(...group.objects);
    }
  }
  return { keep, remove, untouched, newest };
}

export async function retainRemoteBackups({ apply = false } = {}) {
  const { client, bucket } = r2Client();
  const config = readConfig();
  try {
    const objects = []; let token;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'ops/pc-backend/', ContinuationToken: token }), { abortSignal: AbortSignal.timeout(30000) });
      for (const o of page.Contents ?? []) if (o.Key?.includes('/backups/')) objects.push({ key: o.Key, size: o.Size, etag: o.ETag, lastModified: o.LastModified?.toISOString() });
      token = page.NextContinuationToken;
    } while (token);
    const capturedAt = new Date().toISOString();
    const plan = planRetention(objects, Date.parse(capturedAt));
    const summary = { capturedAt, apply, keep: plan.keep.length, remove: plan.remove.length, untouched: plan.untouched.length, reclaimedBytes: plan.remove.reduce((sum, o) => sum + o.size, 0) };
    const manifest = resolve(directory, `retention-${capturedAt.replace(/[:.]/g, '-')}.json`);
    writePrivate(manifest, JSON.stringify({ bucket, ...summary, ...plan }, null, 2));
    if (!apply) { console.log(JSON.stringify(summary)); return summary; }
    // Prove that the newest retained generation from every PC can be recovered
    // before deleting any old generation. No database writes are performed.
    for (const object of plan.newest) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key, IfMatch: object.etag }), { abortSignal: AbortSignal.timeout(30000) });
      const encrypted = Buffer.from(await result.Body.transformToByteArray());
      if (!result.Metadata?.sha256 || createHash('sha256').update(encrypted).digest('hex') !== result.Metadata.sha256) throw new Error('Retained backup checksum failed');
      const dump = decryptBackup(encrypted, config.backupKey);
      if (dump.subarray(0, 5).toString() !== 'PGDMP') throw new Error('Retained backup is not a database dump');
      if (result.Metadata.recovery) await downloadRecovery(client, bucket, result.Metadata.recovery, config.backupKey, dump, object.key.split('/')[2]);
    }
    let deleted = 0;
    try { for (const object of plan.remove) {
      if (!object.etag || !Number.isSafeInteger(object.size)) throw new Error('Incomplete deletion manifest');
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key }), { abortSignal: AbortSignal.timeout(10000) });
      if (head.ETag !== object.etag || head.ContentLength !== object.size) throw new Error('Backup changed after retention snapshot');
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.key, IfMatch: object.etag }), { abortSignal: AbortSignal.timeout(10000) });
      deleted++;
    } } finally {
      writePrivate(resolve(directory, 'retention-status.json'), JSON.stringify({ ...summary, completedAt: deleted === plan.remove.length ? new Date().toISOString() : null, deleted, manifest }));
    }
    console.log(JSON.stringify({ ...summary, deleted }));
    return summary;
  } finally { client.destroy(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await retainRemoteBackups({ apply: process.argv.includes('--apply') }); }
  catch { console.error('Retention failed; inspect the private manifest and retention status before retrying.'); process.exitCode = 1; }
}
