# Local Auth and images: preparation only

This candidate uses the current app, one private GoTrue issuer, PostgREST and
PostgreSQL. Select `ops/pc-host/environment.local.example.env` for a separate
release. Keep the host/task disabled. The Cloudflare hostname and real provider
settings are not chosen by this template.

The PC can run the Linux services in its existing WSL environment, with new
private namespaces/data directories. Do not attach a review database to a
production host or replace the current WSL/DB/Jobs installation. This is also
the portable shape for the future Linux notebook. Do not restart Surface.

## Identity and Google login

GoTrue listens on private loopback 18001; PostgREST on 18002; DB stays private.
GoTrue `API_EXTERNAL_URL` is the final app origin plus
`/api/pc-supabase/auth/v1`, and `SITE_URL` is the app origin. The Google callback
is `API_EXTERNAL_URL + /callback`; the app callback is `/auth/callback`.
Register only these verified final HTTPS destinations in Google's console.
Provider secrets stay in the Auth owner's private environment. Public routes
permit Google PKCE, refresh, user, logout and public JWKS; never admin, signup,
password grant or privileged API keys. Private synthetic password login is a
test bootstrap and does not enable password login in the public app.

The disabled private service template is `auth.example.env`. New permitted Google
users need signup enabled as well as the existing before-user-created allowlist
hook; `DISABLE_SIGNUP=true` is only a preparation hold. Verify allowed and denied
first-time Google users, returning users and allowlist revocation on the isolated
candidate before enabling it. Hook configuration follows the
[official self-hosted hook guide](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-hooks).

Use one local JWT issuer/public key set for Auth and REST. Remove cloud issuer
trust from the new instance only. Do not publish HMAC/private signing keys in
JWKS or copy legacy mixed-JWKS configuration. Local sessions use the separate
`sb-pc-backend-auth` cookie. Existing cloud sessions require reauthentication.
Preserve `auth.users.id`, identities, password hashes where applicable,
profiles/roles/login allowlist and references. Cloud mirrors of users are not
assumed to contain the complete Google identities. Export Auth from its actual
authoritative source, snapshot both targets, and compare UUID/identity/role
conflicts in dryRun before any import. Ambiguous matches stop the import.

## Images and rollback

Keep images outside the release/public tree, under an app-owned private root.
Linux directories use 0700/files 0600; Windows needs accepted NTFS ACLs and
protected parents, since chmod alone does not establish that boundary.
Use the offline importer in IMAGES.md to preserve paths and bytes, including
pending cleanup references. It defaults to dryRun and never deletes sources.
Retain old R2/Supabase image copies and old Auth until the new origin, real
Google login, images, permissions and rollback are accepted.

## Backup is not business fallback

Keep the Linux capture/restore CLI in BACKUP.md disabled until its actual
source/writer/storage inventory has been accepted. It snapshots DB including
Auth, all private images and Jobs evidence in a verified AES-256-GCM archive.
Transfer the verified archive with `offsite.mjs`: its default dryRun makes no
provider call, and explicit `--apply` requires an enabled private configuration.
It uses the separate backup R2 credential, a new native-source UUID/namespace,
conditional immutable PUT and complete ciphertext readback. It includes all
existing keys in the bucket's capacity count and never deletes older archives.
An unknown transfer intent prevents resending the same attempt. Keep the old
production backup namespace untouched during preparation.

Configure the existing backup owner's `localSnapshotReceiptFile` to the new
offsite-private/local-snapshot.json, and `localImageRoot` to the actual serving
root. This mode performs DB identity/heartbeat checks and consumes the private,
current-generation combined-snapshot receipt; it does not run another DB-only
dump/upload pipeline. The app also rejects stale, wrong-root/wrong-generation,
missing independent-key or DB-only receipts. Keep capture/copy scheduling
disabled until source inventory, credentials, key recovery, capacity/duration
and physical off-PC restoration are accepted. Capture a fresh archive after
each backup-owner generation starts; an older boot's receipt cannot unlock it.

```
node ops/local-minimal/offsite.mjs /private/offsite.json
# After the verified source/destination and explicit configuration are ready:
node ops/local-minimal/offsite.mjs /private/offsite.json --apply
```

Before enabling business writes, connect a PC-external encrypted archive
destination (existing private R2 or separate physical media), verify complete
readback of the exact ciphertext and restore DB/Auth/images/journal from that
off-PC copy. Store the decryption key and private Auth/provider/image signing
configuration separately so loss of this PC does not destroy recovery. Test
same UUIDs/identities, grants/RLS, image hashes/DB references, unknown external
outcomes and disabled old Jobs after restore. The key, actual destination,
retention/capacity, source inventory and cold recovery are owner-specific
acceptance conditions; a placeholder or local test cannot satisfy them.

## Cutover boundary

Keep one writer, one image root and one Jobs journal. Reconcile old pending
business writes before retiring replay/mirror. Take coordinated snapshots and
dryRun before actual migration; cutover itself remains unapproved in this task.
Final dedicated account/ACLs, full backup admission, OAuth/phone/PWA/Push,
restart/cold restore and rollback must pass before switching the public entry.

The new `20261012180000_local_backup_write_guard.sql` and
`20261012181000_local_web_push.sql` migrations are disabled preparations, not
production applications. Local Push uses the existing shared-PC Jobs owner and
the same journal; `LOCAL_WEB_PUSH_ENABLED=false` is the preparation default.
Keep the matched existing public/private VAPID keys and verify real new-origin
phone/PWA subscription and delivery before retiring cloud delivery.

The Linux snapshot producer accepts a deliberately minimal schema and writer
inventory. It refuses a vendor Supabase database containing installed cron or
additional namespaces (including Vault/net). The complete-schema review in
`ops/pc-host/backup-review` proves candidate-schema restoration and synthetic
Vault/inactive cron separately; it does not prove this stricter producer can
capture the actual PC. Inspect the authoritative source and rehearse a curated
clone or extend capture/recovery coverage before enabling the producer. Never
drop vendor schemas or deactivate production jobs merely to pass its gate.
Use the same image-root path for app, capture and receipt; Windows and Linux
paths are not interchangeable. Build Linux dependencies and its release on
Linux when placing the full app in WSL/the future notebook.
