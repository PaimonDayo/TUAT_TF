# PC backend status — 2026-09-09

**15:00 JST更新: 本番はPC DB/Authへ切替済み。所有者の実ログイン成功確認済み。期限は9月16日15:00。クラウド書き込みと旧cronは凍結中。**

最新の引き継ぎは [PC-PRODUCTION-HANDOFF.md](PC-PRODUCTION-HANDOFF.md)、復帰操作は [RETURN-TO-SUPABASE.md](RETURN-TO-SUPABASE.md)。Google追加、Vercel秘密設定、R2暗号化DBバックアップは明示承認済み。Web Pushは鍵未取得で未移行。

## 以下は切替前の履歴（現在の状態として使わない）

Production `tuat-tf.vercel.app` still uses cloud Supabase. The seven-day period has **not started**. Do not switch production solely because the preview built successfully.

## Implemented and verified

- The Vercel browser API forwards Auth/REST to the PC with an independent server-only transport key. Supabase still verifies member JWTs and RLS; the public proxy rejects privileged credentials and enforces Origin on writes.
- Signed, short-lived R2 endpoint records allow the tunnel address to change without rebuilding the app. Expired/unverified endpoints fail closed; writes are never automatically replayed.
- PC DB backups are AES-256-GCM encrypted, checksummed and uploaded to the owner's private R2 bucket. A downloaded backup restored successfully into a separate local database.
- Return-transfer rehearsal covered 45 application/Auth identity tables: one insert, one edit containing SQL metacharacters/Japanese/newlines, one delete; baseline mismatch and broken FK both rejected with complete rollback. This was a **local rehearsal**, not a managed-cloud restore.
- All 209 Vitest tests, two gateway/encryption tests, targeted ESLint, TypeScript and a PC-configured Next production build passed. Client build assets contained none of the private backend keys.
- Google OAuth callback URLs were added with explicit owner approval, preserving the existing Supabase callback and original client secret. The new secret was entered locally by the owner; Google is configured on the PC for the preview callback.
- Isolated preview deployed successfully: `https://tuat-tf-pc-preview.vercel.app`, deployment `dpl_CWiY39ma9eZ7vBAs3N4qjzWR3uaa`. Its runtime contains PC/R2 settings; image writes and sheet sync are disabled during this stage. Real OAuth login and CRUD from this deployment are not yet verified.

## Explicit authorizations

- Owner approved adding the two Google callback URLs and saving the PC bridge/service-role keys and R2 settings to their Vercel projects. The earlier upload rejection was resolved by this approval.
- A subsequent auto-review separately rejected full DB backup transfer to R2. The owner then explicitly approved AES-encrypted backups containing posts, profiles and authentication data to their `tuat-tf-images` bucket under `ops/pc-backend/…/backups/`, every 15 minutes, with the decryption key excluded from R2. Backup supervision was resumed after that approval.
- Owner says McAfee VPN is unwanted and turns itself on; stopping its VPN and automatic connection is authorized. Antivirus/firewall shutdown is not requested. Native UI control is unavailable. The targeted `Disable-NetAdapter` command was denied by **Windows access permissions**, not by auto-review. McAfee was opened and the owner was given the VPN-only setting steps.

## Network and task work still under verification

- Current Wi-Fi was iPhone tethering. Windows IPv4 default-half routes `0.0.0.0/1` and `128.0.0.0/1` point to `McAfee_VPN` via `192.168.0.1`, while that VPN reports no connectivity. Windows CLI HTTPS and WSL Google DNS/HTTPS failed intermittently. A DNS cache clear helped some Vercel CLI calls, but did not resolve the VPN routing problem.
- The old Docker `local_gateway` subnet `172.20.0.0/16` overlapped tethering `172.20.10.0/28`. It was moved to `10.253.254.0/27`; Auth outbound now uses `10.253.254.32/27` and `fdce:7b29:9c45::/64`.
- WSL has been changed to mirrored networking with DNS tunneling and firewall enabled. There was no prior `.wslconfig`; the original absence is recorded in `.contingency/backend/wslconfig-before.json`. A local-only DB backup was verified before graceful Docker shutdown; no database volumes were removed. All 11 containers subsequently became healthy. Google outbound still needs verification after VPN disconnect.
- Scheduled task `TUAT PC Backend Temporary` runs only in the owner's logged-in session and retries every minute. Its startup logic was revised to avoid PowerShell stderr handling and waiting forever on the WSL holder. Latest task execution failures still need investigation; do **not** assume restart reliability is proven. `task.log`/`runtime-status.json` can be stale—check timestamps and actual processes.
- Maintenance is currently enabled in `.contingency/backend/config.json`. The gateway also rejects requests after `returnAt` or when verified backups become stale. `startedAt` and `returnAt` are null.

## Required before production

1. Resolve VPN/network connectivity; verify Windows API, WSL and Auth-to-Google communication, loopback-only public ports, task restart and reconnect recovery. Ensure power/sleep/lid behavior is suitable and record restoration settings.
2. Verify Google OAuth with an existing member and real preview reads/writes/RLS. Keep test data isolated and remove fixtures.
3. Finish notification/sheet synchronization handling. Existing PC cron/edge outbound were intentionally stopped; push VAPID private key is not in `.env.local`. Do not claim Push or automatic synchronization migrated.
4. Verify managed-cloud write-freeze privileges and return-import compatibility. Generate a fresh cloud snapshot immediately before cutover; current PC data is older and includes a private trial user. Reconcile current members and remove trial fixtures without losing real changes.
5. Freeze old writers, take final backups, import latest data to PC, verify identities/data/constraints, deploy production and smoke test. Preserve original production environment and cloud platform configuration for return.
6. Record actual successful start and seven-day return time. Schedule a follow-up for the return, which must transfer additions/edits/deletions before reconnecting Vercel to cloud. Never restore service by pointing at the stale cloud DB.

Private inputs, keys, dump files and generated deployment requests remain under `.contingency` or `/opt/tuat-tf-supabase`, excluded from Git. Never print their contents.
