# Consistent encrypted local snapshots

`backup.py` is an opt-in Linux CLI, not a daemon or a Windows host requirement.
It reuses the installed Node runtime for the compatible `TUATPC01` AES-256-GCM
codec, Python standard library, Docker, `pg_dump` and tar. Importing either file
starts no service. This candidate has not been installed on Surface.

## Capture and recovery contract

The CLI freezes the concrete source writers for the capture window only. Freeze
means suspension, **not graceful drain or external dispatch completion**. Jobs
is frozen first, then the app, private Auth and REST. A running or unknown Jobs
entry, interrupted journal temporary file, claimed local Push delivery, active
SQL transaction, unknown SQL client, prepared transaction, DB cron installation
or subscription refuses capture. Schemas beyond the concrete five-schema local
source, foreign tables and materialized views also refuse capture rather than
silently escaping row verification. Historical uncertain/failed/partial Jobs remain
unchanged, including `sheetWritesBlocked`; no request is replayed. The existing
runner lock is copied as evidence and is never stolen, removed or restored over
a live runner by this CLI. Its owner must match the direct labelled fixture's
PID 1/birth time or the fixed systemd Jobs cgroup/actual process birth time;
unknown/stale owners refuse capture before any freeze.

The current journal must use the runner's numeric activation/slot contract and
known job IDs. Current `running`, unknown outcomes or a recovered `uncertain`
record without a finite `finishedAt` refuse a fresh receipt even if no
`status.json` exists. `recoverState` changes interrupted running to uncertain
without adding that terminal evidence; this producer never invents it.
Historical terminal failed/partial/uncertain records and failure/recovery arrays
remain byte-for-byte. A finite finished time proves that the local await ended,
not that an external Sheets/Push action committed or ceased running remotely.
A backup receipt proves the captured local DB/images restored; it cannot clear
those external outcome holds or authorize their replay.

The existing runner's `status.json` is optional but, when present, must match its
actual `{checkedAt, jobs}` format and the captured journal. Each state file is
bounded to 1 MiB. A terminal older status can lag the current terminal journal;
a future slot, contradictory same-slot outcome, running/unknown entry, malformed
state or interrupted temporary file refuses capture. Status is not an authority
to repair a journal. Journal, lock and status bytes are hashed before/after the
same frozen capture, archived together and validated unchanged after extraction.

Every writer must have the pinned source/role labels. Extra source containers,
containers that can reach its DB namespace or image/data mounts, active legacy
mirror and unknown `tuat-*` host services are refused. Label/inventory approval is
an installation prerequisite: the CLI cannot infer that an arbitrary process
without a label will never connect later. The source's DB and images must have
no other operators, external SQL clients, kernel-level sync tool or unaccounted
host writer. A source that cannot meet this concrete inventory is not enabled.

The app image root is scanned without following links, with private owner/mode,
single-link regular files, a 12 MiB image limit and the current path constraints.
Avatar WebP/JPEG, tweet and note WebP paths are preserved. DB avatar fields must
already contain normalized paths; public URLs require the separate offline
import procedure. A referenced image missing after unlink but before DB deletion
is refused. A valid-looking file with no live reference or recorded note cleanup
entry is also refused, including an upload interrupted before its DB save. The
producer leaves such files and rows intact for the existing operation/operator.
The PC profile alone can preserve an explicitly reviewed pre-existing orphan
baseline through optional `retainedUnreferencedImages` in its root-owned private
backup configuration. Its path set must equal the actual unreferenced set after
live references and recorded cleanup/retirement entries are accounted for; every
size and SHA256 must match. Missing, changed, newly unreferenced or now-referenced
baseline files hold capture. No file is deleted or newly approved automatically.

The capture includes a full custom-format `pg_dump`, standard role/membership
SQL without role passwords, all private image bytes, raw Jobs journal/lock and
an encrypted manifest. Before/after comparison covers canonical rows in every
Auth/public/storage/pc_ops/extension table, Auth UUIDs/identities/password hashes,
FK/check constraints, role attributes/membership, ownership/GRANT/RLS, functions/triggers,
sequences, schemas/extensions and every image's path/hash/size/mode/mtime. The
dump keeps all schemas and standard ownership/privileges. Database login
passwords and service configuration (retained cloud issuer/JWKS, private JWT,
GoTrue, Google/GAS, VAPID and image/action signing keys) require separate private
recovery storage; the archive does not claim to recreate those configurations.
Approved baseline image bytes remain in the full image manifest, archive and
restored inventory. They do not weaken either before/after fingerprint check.
Restore creates every nested image/Jobs directory as private 700, checking each
level separately. Existing symlinks or mismatched owners/modes refuse extraction;
the extractor never repairs those paths or overwrites existing files.

The CLI records the exact previous running/paused/frozen state and the intent
**before** issuing a freeze. It checks actual states, captures to private staging,
checks the fingerprints and frozen states again, then restores and verifies the
original states **before** encryption or the potentially slow restore test. A
previously paused/stopped writer stays paused/stopped. An identity change or
unverified resume leaves `capture-state.json` and blocks the next run. A crash
must be recovered from that concrete checkpoint; the CLI has no automatic thaw,
journal rewrite, resend or generic recovery command. Normal exceptions/signals
attempt exact resume. SIGKILL/power loss require operator recovery.

## Verification and receipt

Payload is streamed to private staging files/tar with 1 MiB hashing blocks;
database/image contents never accumulate in RAM or console output. Bound is
16 GiB per bundle, 100,000 images/entries. Stage storage must be an encrypted
filesystem or suitably protected RAM; swap/core-dump policy is part of source
installation. Free space and real capture/restore duration must be measured
before scheduling. The restore container currently uses a 512 MiB temporary DB
with 768 MiB RAM; larger sources fail verification until an explicitly reviewed
capacity change is made. This limit is not a successful large-source proof.

Archives are immutable exclusive publications. Decryption authenticates the
GCM tag before publishing even private plaintext. The authenticated tar is
whitelisted and rejects duplicate names, path traversal, symlinks/nonregular
entries, unlisted files, mismatched hashes and topology; no `extractall` runs.
An independent random-labelled, network-none PostgreSQL 17.6 container restores
roles and the full DB, checks rows/security, and checks separate restored image
bytes/paths/mode/mtime. Only this verifier is deleted, after its label/identity is
checked. The running source is never a restore target.

Only after authenticated integrity, independent restoration and exact writer
resume does the CLI atomically fsync a new receipt:

```json
{"version":1,"sourceId":"pinned-source-id","archiveSha256":"64-lowercase-hex","verifiedAt":"ISO-UTC","restoreVerifiedAt":"ISO-UTC"}
```

This is the existing shared-local Jobs contract. Every archive gets a fresh
independent restore in this conservative producer. `verifiedAt` records the
source's captured snapshot time, proven later by that restoration; a slow verify
cannot make an old snapshot appear newly captured. A restore taking 35 minutes
or longer refuses a fresh receipt. Verification/capture failure
leaves the previous receipt byte-for-byte. Interrupted staging is removed only
inside the CLI's checked private child; source files, journals and prior archives
are never deleted. A completed archive without a receipt is not proof of a
verified current backup. Retention/removal of older archives is deliberately not
automatic in this CLI.

## Verified PC history and retention preparation

For `pc-private`, the offsite sender now preserves one immutable
`<capture-time>.offsite-verified.json` after exact remote ciphertext readback and
before replacing `local-snapshot.json`. It records the source/database/generation,
account-and-bucket scope digest, archive-key identifier, object ETag/hash/size,
and local archive path. The archive-key identifier must match the producer's
independent recovery-key fingerprint before any provider request.
The credential environment is checked again before publication; raw credentials
are never recorded. An unknown PUT intent or a matching filename alone cannot
become verified history. A history write failure preserves the prior current
receipt and does not authorize resending the PUT.

`snapshot-retention.mjs` only selects candidates from supplied verified metadata.
It reuses the existing policy: latest 24 local / 96 remote, one newest snapshot
per represented JST day for 30 days, and the protected current snapshot. A fresh
same-generation protected snapshot must appear unchanged in the input. Foreign
scope or archive key, stale/future evidence, duplicate identities, unexpected paths, unknown
records and metadata accessors refuse the entire plan. Outputs are always dry
runs with `deletionAuthorized:false`; they neither discover actual storage nor
prove quota or authorize removal.

No deletion transport or periodic cleanup is connected by this preparation.
The existing legacy retention recognizes paired `.dump.enc` / `.recovery.json.enc`
objects and deliberately leaves `.local.tar.enc` objects alone. Combined-snapshot
local/remote revalidation, bounded reclaim and partial-delete reconciliation
remain required before long-running production activation. Current source size,
all bucket usage, growth and archive count bounds must be checked; keeping only
the existing byte/count refusal would eventually stop new backups.

## Explicit configuration

All paths are absolute, canonical, owned by the CLI user and private (directories
700/files 600). Source image/Jobs ownership can instead be pinned with
`sourceOwnerUid` (for a root backup operator reading the unprivileged app user's
private files); backup/stage/key ownership remains the CLI user. Image, Jobs,
backup and staging roots must be separate. The CLI
needs access to the existing source's private Docker socket; it uses no TCP DB
password or public privileged API. A private configuration file has this shape:

```json
{
  "version":1,
  "sourceId":"pinned-source-id",
  "writerMode":"surface-systemd",
  "containers":{"db":"tuat-local-db","auth":"tuat-local-auth","rest":"tuat-local-rest"},
  "database":"postgres",
  "dbImage":"supabase/postgres:17.6.1.136",
  "mirrorDisabled":true,
  "sourceOwnerUid":1000,
  "imageRoot":"/var/lib/tuat-local/images",
  "jobsStateRoot":"/var/lib/tuat-local/jobs-state",
  "backupRoot":"/var/lib/tuat-local/encrypted-backups",
  "stageRoot":"/private-encrypted-stage/tuat-local",
  "runtimeKey":"/private-runtime-keys/tuat-local-backup.key",
  "recoveryKeyCopy":"/mounted-independent-recovery/tuat-local-backup.key",
  "receiptFile":"/var/lib/tuat-local/encrypted-backups/verified.json"
}
```

For `profile: "pc-private"`, a nonempty baseline additionally requires the existing
sealed controller. Root owns the 700 configuration directory and 600 config file;
the runtime manifest pins that backup configuration's SHA256 and the controller
seal rechecks it. An actor-writable image directory or image-side metadata never
authorizes retention. The optional object defaults to `{}` (the previous orphan
refusal). Each exact safe image path maps to **only** `sha256` (64 lowercase hex)
and `bytes` (an integer from 1 through 12 MiB); entry count and total bytes retain
the existing archive bounds. For example, using synthetic metadata only:

```json
"retainedUnreferencedImages": {
  "avatars/example/retained.webp": {
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bytes": 128
  }
}
```

The operator must measure and approve the existing source baseline privately;
this example is not a valid source approval. A refusal preserves source files,
Jobs state and the previous receipt for reconciliation without replay.

Source containers carry `tuat.local.source=<sourceId>` and
`tuat.local.role=db|auth|rest`. Host mode accepts only fixed
`tuat-local-jobs.service`, `tuat-local-app.service` and disabled
`tuat-local-mirror.service`, using verified `systemctl freeze/thaw` states.
Native Jobs snapshots also retain the launcher's `lifetime.lock` alongside
the journal, runner and status files. These archived bytes never establish a
live owner: PC capture additionally verifies the running Jobs PID's actual
kernel FLOCK on that exact protected inode. A mismatched or unheld lock refuses
capture; restoring a lock file does not acquire a lock or authorize replay.
The mirror may be absent only when `systemctl show` explicitly returns
`LoadState=not-found`, inactive/dead, running freezer, zero MainPID/ControlPID
and an empty cgroup. A loaded mirror needs the same inactive/process-free
proof; active/failed/activating/masked/unknown observations refuse capture.
No mirror stub or extra service is created to satisfy this inventory.

Only the exact preserved old trial names `tuat-surface-trial-adapter.service`,
`tuat-surface-trial-app.service`, `tuat-surface-trial-bridge.service` and
`tuat-surface-trial-gateway.service`, plus the existing 24h logger
`tuat-surface-trial-endurance.service`, may also be present. Each must be loaded,
inactive/dead, with zero MainPID/ControlPID, running freezer and an empty cgroup.
They are never frozen, started or thawed by this CLI. These preserved states
and mirror absence/disabled state are checked again during capture and exact
resume verification, including a fresh fixed-scope unit inventory. A new unit,
external state change or unverified observation refuses publication and leaves
`resume-unverified` when detected during resume; the producer still attempts
to thaw its own unchanged writer identities and never manipulates old units.
Any other `tuat-*` unit still refuses capture,
including an unreviewed backup scheduling unit. Host writer snapshots retain
MainPID/ControlPID alongside cgroup/freezer state so a changed process cannot
silently pass resume verification.
Docker fixture mode explicitly lists `db/auth/rest/jobs/app` containers instead;
its proof does not demonstrate an installed host systemd configuration or
Surface restart behavior. The CLI creates no units/tasks and disables no old
Jobs/mirror/cron. Host names/inventory must be aligned during a separate concrete
installation review; arbitrary shell hooks cannot declare quiescence.

```sh
python3 ops/local-minimal/backup.py --config /private-config/backup.json
python3 ops/local-minimal/backup.py --config /private-config/backup.json --execute
```

Default validates shape only and makes no runtime readiness claim. The recovery
copy must have been genuinely retained outside Surface, with its storage and
custody separately verified. Reading two equal paths proves their availability
and equality, not that they are physically on different machines. Do not derive
a recovery key from changing service/JWT credentials, discard a key while its
archives remain needed, or wire a synthetic receipt into Jobs. A standalone
Surface runtime key and off-device recovery custody are separate requirements.
`recoveryKeyCopy` is optional at runtime: supply it for installation/key-change
proof while that independent copy is accessible. Normal periodic capture can
authenticate/restore with the runtime key without keeping cold recovery storage
connected. The result states whether the independent copy was actually checked;
omitting it makes no new off-device custody claim.
The encrypted manifest and result keep the SHA-256 recovery-key fingerprint,
which must match the separately retained key record. A runtime key changing
during capture/verification refuses publication of a new receipt.

## Synthetic checks

`backup.test.py` injects only fake local service observations: exact state/order,
freeze timeout after success, changed identities, external thaw, exclusive
producer lock, running/uncertain journal preservation, active DB/Push refusal,
unsafe archive/image entries, verification failure retaining the previous
receipt, and a directory fsync failure after atomic replacement.
The host-mode fixtures exercise the real inventory branch, process-free old
five-service trial preservation, explicitly absent mirror,
unknown/active/failed/PID/cgroup faults, newly appearing units, and a preserved
unit/process identity changing during capture or resume. Real numeric journal
and runner status fixtures test raw historical holds, status lag, missing
terminal evidence without status, exact archive/extraction, changing capture
bytes and failed publication retaining the original receipt.
They make no installed Surface boot/systemd or real host freeze claim.
`backup-codec.test.mjs` checks private key/symlink/hardlink bounds, immutable
publication and authentication failure without plaintext output.

The dedicated `work/local-backup-proof/prove-producer.py` uses real labelled
Docker writers and PostgreSQL, cached sharp-encoded/decoded WebP bytes, a fresh
independent PG restore, raw uncertain journal and a previously paused Auth
container. It also refuses an unlink-before-DB-delete gap, running Jobs and
claimed Push, and refuses wrong-key/tampered ciphertext. All fixture keys,
archives, containers and plaintext are removed afterward. Its saved receipt is
an expired proof artifact, never a production Jobs freshness input.
That older proof's illustrative activation/slot strings predate the stricter
actual runner schema and do not prove the current status/host integration. A
fresh real producer/PG restore proof using numeric runner state and status is
required before installing this version.

Specifications: [Docker pause/freezer](https://docs.docker.com/reference/cli/docker/container/pause/),
[PostgreSQL default ACL semantics](https://www.postgresql.org/docs/17/catalog-pg-default-acl.html),
[PostgreSQL 17 dump/roles](https://www.postgresql.org/docs/17/app-pg-dumpall.html),
[PostgreSQL 17 SQL dump](https://www.postgresql.org/docs/17/backup-dump.html).
