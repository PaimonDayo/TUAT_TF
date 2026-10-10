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

結果には固定image、migration/test SHA256、成功範囲とcleanupを保存する。失敗したmigrationを適用済みにせず停止する。cleanupは今回作成した正確なresourceだけをlabel/ID/name/volume absolute mountpoint/network internal属性で照合してから行い、所有者不一致なら残す。全コンテナ/volume/WSLを停止しない。
