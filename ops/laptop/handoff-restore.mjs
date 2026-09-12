// 別のPCへサーバーを引き継ぐとき、R2に残っている「前のPCの」暗号化バックアップを
// 取り出して復号する。DBへ流し込むのは restore-wsl.sh の仕事で、ここではしない。
//
//   node ops/laptop/handoff-restore.mjs --list
//   node ops/laptop/handoff-restore.mjs --list --from-instance <uuid>
//   node ops/laptop/handoff-restore.mjs --from-instance <uuid>
//
// backup-backend.mjs の downloadAndVerifyLatest() は「自分のinstanceIdの最新1件」しか
// 取れない（取り違え防止のための意図的な制限）。引き継ぎでは別インスタンスを指すため、
// 取り出し元を明示させるこの専用経路を使う。
//
// 復号鍵はR2に置かず、元のクラウドのservice-roleキーから決まる。つまり `.env.local` を
// 安全に持ち込めていれば、新しいPCでも前のPCのバックアップを開ける。
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { directory, writePrivate, r2Client, configPath, readConfig, cloudEnv } from './backend-files.mjs';
import { decryptBackup } from './backup-backend.mjs';

const PREFIX = 'ops/pc-backend/';
const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const instanceArg = args[args.indexOf('--from-instance') + 1];
const instance = args.includes('--from-instance') ? instanceArg : null;
if (args.includes('--from-instance') && !/^[0-9a-f-]{36}$/.test(instance ?? '')) {
  throw new Error('--from-instance takes the previous PC instance id (uuid)');
}
if (!listOnly && !instance) throw new Error('Use --list first, then --from-instance <uuid>');

// config.json はこのPCの分。まだ無い引き継ぎ直後でも、元のキーから復号鍵を作れる。
const backupKey = existsSync(configPath)
  ? readConfig().backupKey
  : createHash('sha256').update('tuat-pc-backup-v1\0' + (cloudEnv().SUPABASE_SERVICE_ROLE_KEY ?? '')).digest('hex');
if (!/^[0-9a-f]{64}$/.test(backupKey)) throw new Error('Could not derive the backup key; check .env.local');

const { bucket, client } = r2Client();
try {
  const listAll = async (prefix, delimiter) => {
    const keys = [], folders = [];
    let token;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: delimiter, ContinuationToken: token }),
        { abortSignal: AbortSignal.timeout(30_000) });
      for (const o of page.Contents ?? []) keys.push({ key: o.Key, size: o.Size, at: o.LastModified });
      for (const p of page.CommonPrefixes ?? []) folders.push(p.Prefix);
      token = page.NextContinuationToken;
    } while (token);
    return { keys, folders };
  };

  if (!instance) {
    // どのPCの控えがあるかを一覧する。中身は取りに行かない。
    const { folders } = await listAll(PREFIX, '/');
    const rows = [];
    for (const folder of folders) {
      const id = folder.slice(PREFIX.length).replace(/\/$/, '');
      const { keys } = await listAll(`${folder}backups/`);
      // 既定の sort は Date を文字列にしてしまい曜日名で並ぶ。数値で比べる。
      const newest = keys.map((k) => k.at).filter(Boolean).sort((a, b) => a - b).at(-1);
      rows.push({ instanceId: id, backups: keys.length, newest: newest?.toISOString() ?? null });
    }
    console.log(JSON.stringify({ bucketPrefix: PREFIX, instances: rows }, null, 2));
    console.log('\n引き継ぎ元のinstanceIdを選び、--from-instance <uuid> で取り出す。');
  } else {
    const prefix = `${PREFIX}${instance}/backups/`;
    const { keys } = await listAll(prefix);
    if (!keys.length) throw new Error(`No backups under ${prefix}`);
    // キーはISOのタイムスタンプなので、辞書順＝新しい順で並ぶ。
    const newest = keys.sort((a, b) => (a.key < b.key ? -1 : 1)).at(-1);
    if (listOnly) {
      console.log(JSON.stringify({ instance, backups: keys.length, newest: newest.key, bytes: newest.size, at: newest.at }, null, 2));
    } else {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: newest.key }), { abortSignal: AbortSignal.timeout(120_000) });
      const encrypted = Buffer.from(await result.Body.transformToByteArray());
      const recorded = result.Metadata?.sha256;
      const actual = createHash('sha256').update(encrypted).digest('hex');
      if (recorded && recorded !== actual) throw new Error('Backup checksum does not match what was uploaded');
      // 復号が通ること自体が改ざん検出（AES-256-GCM の認証タグ）。
      const dump = decryptBackup(encrypted, backupKey);
      if (dump.subarray(0, 5).toString() !== 'PGDMP') throw new Error('Decrypted file is not a PostgreSQL dump');
      const output = resolve(directory, 'handoff-restore.dump');
      writePrivate(output, dump);
      console.log(JSON.stringify({ source: newest.key, uploadedAt: newest.at, encryptedBytes: encrypted.length, dumpBytes: dump.length, checksumVerified: Boolean(recorded), output }, null, 2));
      console.log('\n復号できた。DBへ入れるのは別手順（SERVER-HANDOFF.md）。この .dump は秘密扱いで、復元後に消す。');
    }
  }
} finally {
  client.destroy();
}
