# Read-only failover reconciliation preparation

Prepared 2026-10-11; no production rows/settings have been read by this candidate,
no real snapshot has run, and no retirement or acknowledgement is authorized by
these files. The owner's last observed queue count was 17, all with attempts at
least 5. That observation is not refreshed or converted into a clean queue here.

## Current protections and scope

The queue schema is migration `20260926050000_failover_change_log.sql`: `id`,
`table_name`, `op`, `pk`, `row_data`, `changed`, `created_at`, `attempts`, and
`last_error`. INSERT records the full new row; UPDATE records the full new row
plus the changed column names; DELETE records the primary key with null row data.
The queue has RLS and no anon/authenticated grants.

`cloud-mirror.mjs`/`cloud-mirror-ob.mjs` skip replay units with attempts >=5, but
read all pending attempts for mirror protection. Pending keys cannot be mirror
upserted/deleted. OB event operations protect both division siblings; their
replay uses the family RPC and preserves original audit/journal snapshots.
These protections remain active. This preparation never imports the executable
mirror module, calls its replay RPC, or updates queue/mirror/state/Jobs journals.

## Comparison contract

The private report groups queue events by table and exact primary key, orders by
lossless ID, composes INSERT/full-row and UPDATE/changed-column expectations, and
handles final DELETE as confirmed absence. All attempts, including blocked ones,
are included. Comparisons keep exact bigint/numeric digits and canonical JSON
object ordering. A matching UPDATE means only its queued changed/insert columns
match; unrelated current PC values are not inferred from stale cloud snapshots.
Numeric spelling normalizes exact decimal/exponent values only. Date/timestamp,
character padding, timezone spelling, and text are compared exactly; no coercion
or undocumented normalization can turn differing evidence into a match.

- `pc_matches_final_change`: the observed final scoped values match, or a final
  DELETE is confirmed absent with any necessary natural-key identity check.
- `divergence`: a confirmed PC state differs, an expected key is absent, or a
  natural-key alternative exists under another primary key.
- `schema_mismatch`: known table/key/column schema differs, a target column is
  absent, or the API explicitly reports a missing table/column.
- `unknown`: failed/null/invalid/nonunique reads, malformed/unsupported events,
  primary-key changes, unproved natural-key identity, protected sibling failure,
  or observed queue/schema/target drift.

Every classification keeps `effectsVerified=false` and
`acknowledgementAllowed=false`. The overall report always keeps
`retirementReady=false` and `triggerAndJournalEffectsVerified=false`.
Column-state matches cannot prove historical trigger, cross-row, family RPC,
audit, notification or journal completion. A missing original DELETE payload on
a natural-key table can therefore remain unknown. No volatile columns are
silently excluded, and no current-match result authorizes replay or deletion.

## Bounded read plan for root review

There is deliberately **no production CLI/settings loader** in this candidate.
`run-reviewed.mjs` is an import-only entry for the root-reviewed wrapper. Direct
CLI invocation exits 1 with "No capture ran". Its `runReviewedCapture` validates
the target proof/recovery key, verifies the private destination before any
network response, performs the bounded capture, and persists/authenticates the
pair. It returns only aggregate counts, consistency flags, capture UUID and
ciphertext hashes after readback. Failure throws a fixed sanitized message;
underlying response/command/path/PK exceptions are not propagated.
The root must review the actual execution wrapper, identity evidence, destination
and arguments before any real capture. The module API is:

1. Obtain cloud URL/key only from the established
   `D:\TUAT_TF\.contingency\backend\production-rollback-env.json`, and PC URL/key
   only from `D:\TUAT_TF\.contingency\local-app.env`, in memory. Independently
   compare those origins with the root's authoritative target pins. Real mode
   permits only the verified HTTPS Supabase project and `http://127.0.0.1:8000`.
2. Verify the actual existing PC backend runtime entry, executable, ownership,
   instance ID and relation to the established WSL DB/API. Correlate the known
   private backend config/runtime metadata with the running listener; hash that
   proof. A URL, unrelated same-name DB, PID alone or caller-supplied boolean is
   not an adequate operational proof. Pass only reviewed origins, settings
   hashes, runtime proof hash and instance ID to `createReadOnlyReader`.
3. Before network reads, call `prepareSnapshotDirectory(ownerPrivateDirectory)`
   to verify the destination outside every Git ancestor, exact owner/SYSTEM ACLs,
   and safe parents. Existing unsafe paths are rejected rather than repaired;
   a new directory requires an already reviewed existing parent. Then
   `captureReadOnly(reader, {pageSize:50,maxRows:200})` reads OpenAPI metadata and
   verifies the queue column/key schema. It reads exact count/high-water ID, then
   all queue rows using ascending keyset pages bounded by that ID. A shortened
   page/count mismatch aborts; retry-exhausted rows are included. Only affected
   PC keys, natural alternatives when needed, and protected OB siblings are
   read, each with limit 2. Known mirror table names bound the target scope.
4. Repeat queue/schema and targeted/natural reads to detect changes. This is a
   bounded observational capture, **not an atomic cross-server transaction**.
   Drift becomes unknown; source read/pagination/schema failure aborts without
   claiming any complete reconciliation. Original successful/error response
   bodies stay private in the capture, preserving exact source JSON.
5. Use `prepareEncryptedPair(result, key)` with the existing owner-approved
   256-bit backup/recovery key in memory. Both snapshot and dry-run are AES-256-GCM
   ciphertext, with distinct authenticated kinds, matching capture UUID and the
   report bound to the snapshot plaintext hash. Credentials are not included.
6. `persistEncryptedPair(ownerPrivateDirectory, pair, key)` rejects any Git
   checkout ancestor, applies/verifies owner+SYSTEM private ACLs (POSIX owner
   0700/0600), rejects redirected paths/unsafe parent replacement, and creates
   fresh ciphertext-only files with exclusive creation and fsync. It verifies
   private file ownership/access, reads both ciphertexts back, checks exact
   bytes, authenticates/decrypts both and verifies their binding. No plaintext
   file or secret command argument is created. Partial pairs are retained and
   are not called complete; existing snapshots are never overwritten/deleted.
7. Output only aggregate counts and a success/failure/readback indication.
   Never print the capture, rows, keys, PKs, response bodies, last_error,
   credential-bearing URLs, or decrypted pair. No source/target write method,
   automatic replay, ACK, DELETE, attempts reset or status-success update exists.

The transport uses GET only and accepts only exact metadata, bounded queue
pagination, or single-PK/natural-key equality query shapes. Text filter values
are double quoted with quote/backslash escaping before URL encoding, following
[PostgREST URL grammar](https://docs.postgrest.org/en/v16/references/api/url_grammar.html).
Auth/RPC/unrelated tables, embeddings, logical operators, duplicate parameters,
unbounded filters, traversal and fragments are refused before dispatch. Redirects
are errors, and there is no retry. Defaults cap requests at 832, each response at
2 MiB, total response bytes at 16 MiB, each request at 30 seconds and the whole
read transport at 5 minutes. The encrypted snapshot/report plaintext budgets are
64/16 MiB. These are preparation safety caps; larger queues abort for review.

Proposed nonsecret execution synopsis, **not executable approval**: Node 24,
the three established settings/runtime proof sources above, real fixed targets,
page 50/max 200, existing in-memory backup key, and an owner-private destination
outside Git selected and checked by root. No live wrapper/secret-bearing argument
is checked in. Read-only capture does not require stopping the existing mirror
or changing tasks; simultaneous activity can legitimately yield unknown.

The wrapper supplies this in-memory contract after those checks, without keys
or decrypted rows in CLI arguments/environment/log output:

```js
await runReviewedCapture({
  cloud: { url: reviewedCloudOrigin, key: cloudServiceKey },
  pc: { url: 'http://127.0.0.1:8000', key: pcServiceKey },
  expected: {
    cloudOrigin: reviewedCloudOrigin,
    pcOrigin: 'http://127.0.0.1:8000',
    cloudSettingsHash, pcSettingsHash, pcRuntimeProofHash, pcInstanceId,
    authoritativeSettingsVerified: true,
    pcRuntimeOwnershipVerified: true,
  },
  directory: reviewedOutsideGitGenerationDirectory,
  key: approvedRecoveryKeyBuffer, // exactly 32 bytes, never a command argument
  limits: { pageSize: 50, maxRows: 200 },
});
```

These booleans record the wrapper's independently established proof; supplying
them without runtime/listener/WSL instance/system-ID correlation is invalid
operational evidence. If the generation is SYSTEM-only, the execution token
must be SYSTEM; the tool does not bypass that ACL or grant the development user
access to an existing directory.

## Local synthetic verification and remaining gates

```powershell
node --test ops/pc-retirement/reconcile.test.mjs
node --test ops/pc-retirement/snapshot.test.mjs
```

Tests inject fake `*.example.test` transports and synthetic rows/keys only. They
cover final-state composition, null/error/absence distinctions, retry holds,
schema/key/natural-key risks, exact numbers, key grammar escaping, bounded
pagination/budgets, drift, held OB siblings, strict read scope and authenticated
encrypted-pair tampering/mix-up rejection. The disk test requires an explicit
`TUAT_RETIREMENT_SYNTHETIC_DIRECTORY` outside Git; it creates a fresh UUID child
with synthetic ciphertext only and removes only that child after readback.
On 2026-10-11 all 16 transport/classifier/entry/disk tests passed on
Windows under the development account, with actual ACL verification, fsync,
authenticated disk readback and overwrite refusal. PowerShell parsing and
targeted ESLint also passed. These tests do not establish production origins,
runtime/account, the actual generation directory, real queue contents or
operational history. SYSTEM identity deduplicates the private principal set,
but execution under the actual SYSTEM token has not been proved by this test.

Before actual execution, root still needs to approve the wrapper/arguments and
verify the runtime/listener/DB ownership evidence plus the private key/destination.
After a real encrypted capture, any divergence/schema mismatch/unknown and
unproved cross-row/trigger/journal effects need explicit review. Matching rows
alone leave the queue and protections intact; queue deletion is not a readiness
remedy. No task, provider, cutover, production write or commit was performed.
