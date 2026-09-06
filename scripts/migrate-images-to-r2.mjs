/** Default: inventory + snapshot only. --apply: copy and verify, never delete.
 * node --env-file=.env.local scripts/migrate-images-to-r2.mjs [--apply]
 */
import { createClient } from "@supabase/supabase-js";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some((arg) => arg !== "--apply")) throw new Error("Only --apply is supported");
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const directory = resolve(".r2-migration", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(directory, { recursive: true });
async function rows(table, columns) {
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order("id").range(offset, offset + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) return all;
  }
}
const profiles = await rows("profiles", "id, avatar_url");
const tweets = await rows("tweets", "id, user_id, image_path, expires_at");
await writeFile(resolve(directory, "references.json"), JSON.stringify({ profiles, tweets }, null, 2));
const objects = [];
async function inventory(bucket, prefix = "") {
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 100, offset, sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!entry.id) {
        if (prefix) throw new Error("Unexpected nested storage folder");
        await inventory(bucket, path);
      } else {
        const valid = bucket === "avatars"
          ? /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(webp|jpe?g)$/i.test(path)
          : /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(path);
        if (!valid) throw new Error(`Unexpected object path in ${bucket}; review inventory manually`);
        objects.push({ bucket, path, size: Number(entry.metadata?.size ?? 0), updatedAt: entry.updated_at });
      }
    }
    if (data.length < 100) return;
  }
}
for (const bucket of ["avatars", "tweet-images"]) await inventory(bucket);
await writeFile(resolve(directory, "inventory.json"), JSON.stringify(objects, null, 2));
const sourceKeys = new Set(objects.map((object) => `${object.bucket}/${object.path}`));
const referencedKeys = [];
for (const profile of profiles) {
  if (!profile.avatar_url) continue;
  let path = profile.avatar_url;
  if (path.startsWith("https://") || path.startsWith("http://")) {
    const url = new URL(path);
    const prefix = "/storage/v1/object/public/avatars/";
    if (url.origin !== new URL(required("NEXT_PUBLIC_SUPABASE_URL")).origin || !url.pathname.startsWith(prefix)) continue;
    path = decodeURIComponent(url.pathname.slice(prefix.length));
  }
  referencedKeys.push(`avatars/${path}`);
}
for (const tweet of tweets) {
  if (tweet.image_path && (!tweet.expires_at || Date.parse(tweet.expires_at) > Date.now())) {
    referencedKeys.push(`tweet-images/${tweet.image_path}`);
  }
}
// After R2 writes are enabled some references will correctly be R2-only.
// Report these separately; verify them in R2 before calling the cutover complete.
const referencesAbsentFromSource = [...new Set(referencedKeys.filter((key) => !sourceKeys.has(key)))];
await writeFile(resolve(directory, "references-absent-from-source.json"), JSON.stringify(referencesAbsentFromSource, null, 2));
console.log(JSON.stringify({ mode: apply ? "copy-and-verify" : "dry-run", objects: objects.length,
  bytes: objects.reduce((sum, object) => sum + object.size, 0), referencesAbsentFromSource: referencesAbsentFromSource.length, snapshot: directory }));

if (apply) {
  const account = required("R2_ACCOUNT_ID");
  if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error("Invalid account ID");
  const client = new S3Client({ region: "auto", endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
  const bucket = required("R2_BUCKET_NAME");
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const results = [];
  try {
    for (const key of referencesAbsentFromSource) {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    }
    for (const object of objects) {
      const key = `${object.bucket}/${object.path}`;
      const { data, error } = await supabase.storage.from(object.bucket).download(object.path);
      if (error || !data) throw error ?? new Error("Source download failed");
      const bytes = Buffer.from(await data.arrayBuffer());
      const sha256 = hash(bytes);
      let exists = false;
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        exists = true;
      } catch (error) {
        if (error.$metadata?.httpStatusCode !== 404) throw error;
      }
      if (!exists) {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes,
          ContentType: data.type || (/\.jpe?g$/i.test(object.path) ? "image/jpeg" : "image/webp"),
          CacheControl: object.bucket === "avatars" ? "private, max-age=604800" : "private, max-age=240",
          Metadata: { sha256 }, IfNoneMatch: "*",
        }));
      }
      const copy = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const copied = await copy.Body.transformToByteArray();
      if (hash(copied) !== sha256) throw new Error("Destination differs; refusing to overwrite an existing image");
      results.push({ key, bytes: bytes.length, sha256, status: exists ? "verified-existing" : "copied-verified" });
      await writeFile(resolve(directory, "verified.json"), JSON.stringify(results, null, 2));
    }
    console.log(JSON.stringify({ verified: results.length, total: objects.length, sourceDeleted: 0, databaseChanged: 0 }));
  } finally {
    client.destroy();
  }
}
