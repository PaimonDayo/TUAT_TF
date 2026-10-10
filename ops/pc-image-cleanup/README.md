# Confirmed image cleanup candidate

This standalone worker is off by default. It is not wired into Jobs, cron, or a task.
`node ops/pc-image-cleanup/run.mjs` and `--check` start no service and dispatch no DB/R2 request.

Apply `20261011150000_confirmed_image_cleanup.sql` in one migration transaction only after
the operator has reviewed the correct PC database, its migration history, a target snapshot
and dry run. The migration does not inventory R2, backfill references, or change existing
profile/note permissions. Legacy `note_image_cleanup` rows are never read or promoted by
this worker. Unknown upload objects remain retained and still count toward the capacity cap.

Reference changes take a durable per-path row lock through commit. An actual last unlink
confirms retirement in that same transaction. Confirmed paths cannot be reassigned, including
legacy public Storage URL aliases. Cleanup closes only confirmed, currently unreferenced
paths. The tombstone remains after R2 deletion or an uncertain provider response.

Avatar delivery keeps its 604800-second signature and private 518400-second redirect cache.
The GET route stops signing atomically closed paths. R2 deletion waits at least seven days
and ten minutes after worker closure: this covers the PC gateway's 330-second request race,
at most 120 seconds of clock difference in either direction, and a 30-second margin. The
worker checks UTC database time against its PC clock within 120 seconds and checks both
clocks against `delete_after` immediately before DELETE. A gateway with a longer bound
requires a reviewed longer grace. A week of retired storage and all old/unknown objects
remain a capacity cost. This candidate deletes only private R2 keys, not legacy Supabase
Storage objects.

For eventual explicit activation, create an owner/SYSTEM-only private environment file and
a separate private state directory. Supply a version 1 config with `enabled: false`,
`sourceId`, loopback `pcUrl`, exact `database` and PostgreSQL `systemIdentifier`, explicit
`r2AccountId`/`r2Bucket`, `requestTimeoutMs: 330000`, and absolute `environmentFile`/
`stateDirectory`. The dedicated environment contains `PC_IMAGE_CLEANUP_SERVICE_ROLE_KEY`,
`PC_IMAGE_CLEANUP_R2_ACCESS_KEY_ID`, `PC_IMAGE_CLEANUP_R2_SECRET_ACCESS_KEY`, and matching
`PC_IMAGE_CLEANUP_R2_ACCOUNT_ID`/`PC_IMAGE_CLEANUP_R2_BUCKET`. App/inherited credentials are
not used. Do not point this review candidate at production without the owner's activation.

Before `enabled: true`, retire the old Vercel and other old image signing/writing routes
and confirm that one canonical PC signer enforces the closure check through the 330-second
gateway. Old signing routes can otherwise issue fresh seven-day URLs indefinitely, and old
writers can bypass this candidate's physical-retention policy. This remains a manually
invoked operational candidate; it is not ready automatic cleanup and installs no schedule.

Run `--dry-run <config>` to write a private correct-target snapshot and count-only preview;
it never closes a barrier or calls R2. Review these before explicitly setting `enabled: true`
and running `--apply <config>`. Apply requires the snapshot, dry run and current bounded
confirmed listing to match; new rows require another dry run. Each cycle handles at most
100 known paths and stops starting work after 20 seconds. Dependency failure stops the cycle;
an uncertain physical DELETE can be retried only because its permanent DB barrier prevents
any future reference. No save or insert is replayed.

Mock worker tests prove dispatch boundaries, not real R2 credentials/permissions. The SQL
tests and two-session runner require only a newly owned synthetic `tuat_rls_review` database;
they must not inspect or reuse a production or existing review database.
