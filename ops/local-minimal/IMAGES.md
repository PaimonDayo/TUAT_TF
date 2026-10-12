# Frozen image snapshot import

`import-images.mjs` stages an offline frozen export into the same private layout
used by `local-image-storage.ts`. It preserves each existing DB path and byte; it
does not upload, delete, rewrite DB references, or fetch a missing image from the
cloud. Node 24 is required; the two path validators are the existing app exports.

The private JSON manifest contains `version: 1`, the stable `sourceId`, actual
`snapshotAt`, `requiredKeys` from all DB image references and pending cleanup,
and `objects: [{ key, bytes, sha256 }]` from the frozen source bytes. Keys start
with `avatars/`, `tweet-images/`, or `note-images/`. The manifest, source export,
and destination must remain outside the release, with owner-only permissions.
Do not put real manifests, object paths, or image bytes in public Git.

```sh
node ops/local-minimal/import-images.mjs \
  --manifest /private/frozen/images.json --source /private/frozen/images \
  --target /var/lib/tuat-local/images-staged --limit 8000000000
# Only after the frozen snapshot, dryRun and destination are verified:
node ops/local-minimal/import-images.mjs \
  --manifest /private/frozen/images.json --source /private/frozen/images \
  --target /var/lib/tuat-local/images-staged --limit 8000000000 --apply
```

The default dryRun reads and hashes every required object and existing target
without creating files. Apply publishes complete private files atomically and
fsyncs them and directories. A partially imported root can resume only with
identical hashes; conflicts, unrelated objects, missing references, symlinks,
hardlinks, incorrect permissions and excess capacity fail without overwriting
or deleting images. Never point apply at the live serving root: select the
verified staging root during the coordinated single-writer cutover.

Capture must freeze the old app/Jobs image mutations and reconcile DB references
and R2/Supabase Storage sources first. Avatar references can still contain old
public Storage URLs; normalize only using the verified owned project origin and
the app's `avatarStoragePathFromUrl` before creating the manifest. Include pending
note-image cleanup paths. Read failures and missing images are unresolved items,
not empty lists. Retain both original object stores until new API/RLS, actual
image rendering, cleanup, encrypted restoration and rollback are verified.

The synthetic tests prove this importer and real WebP byte preservation; they do
not prove that existing production objects have been exported or moved.
