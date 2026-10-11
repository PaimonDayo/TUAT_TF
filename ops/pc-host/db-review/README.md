# 実 PostgreSQL の隔離スキーマ/RLS試験

`run.ps1` は既定では計画表示だけ。明示 `-Execute` で、WSL Ubuntuにキャッシュ済みの固定Supabase PostgreSQL17 imageを使用する。新規 `codex-auth-dbreview-<GUID>` container/volume/internal networkへowner/generation labelを付け、外部経路・公開portなしで起動する。DBは初期化から `tuat_rls_review`。既存review/supabase container・本番DB・秘密・実ユーザー・providerへ触れない。

PostgreSQL imageだけでは `auth.jwt` / `storage.objects` が未導入なので、固定GoTrue `v2.196.0` の `auth migrate` のみと、固定Storage `v1.73.1` の実tenant SQL全67本を適用する。全imageのSHA256 IDを照合する。Authサービス・Storage HTTPは起動せず、`auth.uid` / `auth.jwt` / RLS / `is_member` を模造しない。Storageの既存platform roleは公式migration wrapperが扱う `storage.install_roles=false` で保持する。取得した公開SQLは担当directory内の一時領域に限り、終了時に削除する。

全候補migrationを名前順・個別transactionで適用し、security migrationを省略しない。旧deploymentのcron更新migration用に本体処理を持たない `SELECT 1` jobを用意し、`cron.launch_active_jobs=off` を維持する。Storageは実SQLの表・関数・RLSで、Storage HTTP、R2、Push/GASの実連携受入とは区別する。

現在のSQL試験 `rls_role_profile_guards.sql` / `rls_rpc_note_access.sql` / `confirmed_image_cleanup.sql` と、大学/許可外部/取消後の既存sessionを確認する `allowlist.sql` は同じ現在候補schemaで実行する。画像migrationの再適用に加え、`pc-image-cleanup/review-races.mjs` を担当WSL adapterから呼び、実2セッションのsave/unlink/claimのロック競合4件を確認する。fixture終了後はAuth user・profile・allowlist・画像barrier/旧queueの0件を確認する。Node24は同梱runtimeを使用し、別環境では `-NodePath` で明示する。

PostgRESTが検証後に置くclaimsのSQL文脈を合成注入するため、JWTの署名検証自体はこの試験の範囲外。app/APIの実HTTP試験、cloud Auth callback、R2 HTTP、実jobs/Drive/Pushは別の受入条件。

```powershell
pwsh -NoProfile -File ops/pc-host/db-review/run.ps1
pwsh -NoProfile -File ops/pc-host/db-review/run.ps1 -Execute
```

実PostgREST/JWTの別試験は `-Api` を付ける。既定は同じく計画だけで、`-Api -Execute` は新規の現在schemaを初期化する。既存SQL/race試験を重複実行せず、その `result.json` を保持して `api-result.json` へ別に記録する。

```powershell
pwsh -NoProfile -File ops/pc-host/db-review/run.ps1 -Api
pwsh -NoProfile -File ops/pc-host/db-review/run.ps1 -Api -Execute
```

固定PostgREST `v14.12` を同じowner付きinternal networkで起動し、HTTPは担当PG containerのcurlから送る。host portを公開しない。ES256/HS256の試験鍵と接続passwordは実行中に生成し、file/Git/ログへ残さない。実JWT署名、改変・期限・audience拒否、本人UUIDと保存件数、他人の更新拒否、複数roleのOR、ノート閲覧範囲、service権限、avatar RPCのmember guard、許可取消後の同じJWTの拒否を確認する。migrationが設定するPostgREST pre-requestを保持し、RLS/policy/Auth helperを追加・置換しない。読み取りの起動確認だけ再試行し、書き込み結果不明を再送しない。

このAPI試験はfictitious signerのJWTを実PostgRESTで検証する範囲。cloud Googleログイン・callback・first-login provisioningのHTTP、実cloud signer/JWKS配布・鍵rotation、公開入口、ブラウザsession、R2/Drive/Push/jobsは未確認のまま。`api-result.json` はJWT/鍵/秘密を含まないassertionとschema hashだけを保存する。

結果には固定image、migration/test SHA256、成功範囲とcleanupを保存する。失敗したmigrationを適用済みにせず停止する。resource作成前に試行を記録し、結果不明でも `cleanup-owned.mjs` が正確なnameから存在を照合する。owner/generation/name/ID/image/公開port/internal network/volume absolute mountpointを検査してから限定削除し、削除後の不存在を確認する。照合の失敗や不明はcleanup成功へ変換せず、資源を残す。全コンテナ/volume/WSLを停止しない。

`node --test ops/pc-host/db-review/cleanup-owned.test.mjs` はDockerを呼ばないadapter試験。PG/Auth/Storage/PostgREST/volume/networkの作成が結果不明になる場合、所有者・世代・公開port・network等の不一致、調査/削除結果不明、削除後も存在する場合を確認する。既存 `result.json` / `api-result.json` は前回の実SQL/API試験の証拠を保持し、このcleanup修正を実DBで再試験した記録にはしない。
