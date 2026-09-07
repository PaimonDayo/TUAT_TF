# ノートPCでSupabaseを一時運用する準備

2026-09-08時点で **設定のひな形を配置済み・起動／本番切替は未実施**。PCは32GiB RAM、8論理CPU、Cドライブ空き約235GB。Docker、cloudflared、PostgreSQL 17のpsqlが未導入のため、復元リハーサルはまだできていない。

## 配置したもの

- `.contingency/runtime/`: 公式Supabase self-hosted/v0.8.0、固定コミット `241bb11c0627f2981746d37033f57dbfa81d29b0` のDocker構成。PostgreSQL 17.6.1.136（クラウド側17.6.1.127と同じメジャー）。`.env`は未作成。公式サンプルキーのまま起動しない。
- `compose.local.yml`: APIは127.0.0.1:8000、DBは127.0.0.1:15432だけ。プーラーの公開ポートを削除。Compose 2.24.4以上が必要。
- `preflight.ps1`: 導入状況の確認。`backup.ps1`: クラウドのroles/schema/dataを読み取りで保存し、Authユーザーの存在・SHA256を確認。`restore-local.ps1`: アプリテーブルのないローカルDBにだけ復元する。これらは復元成功まで検証済みという意味ではない。
- `cloudflared.example.yml`: 所有ドメインの固定ホスト名でAPIパスだけ公開する設定。Studio・DBの外部公開は禁止。Quick Tunnelの一時URLは切替先に使わない。

`.contingency/`はGit対象外。DB/Auth・バックアップ・鍵を含むため、OSのディスク暗号化とアクセス権を確認し、秘密をリポジトリや会話に貼らない。

## ローカル構築

1. Docker Desktop（WSL2/Linux containers）とCompose、PostgreSQL 17クライアント、cloudflaredを導入。PCのスリープ・自動再起動を運用期間中調整し、電源と回線を確保する。無料枠の代わりにPCと回線の停止がアプリ停止になる。
2. `./ops/laptop/preflight.ps1` を実行。初回配置をやり直す必要がある場合は、既存runtimeを消さず別途退避を検討する。準備スクリプトは既存runtimeがあると停止する。
3. runtimeで `.env.example` から `.env` を作り、公式 `utils/generate-keys.sh` と `utils/add-new-auth-keys.sh` をWSL内で実行する。公式手順に沿って全サンプル秘密値を置き換える。JWT、ANON、SERVICE_ROLE、DB、Studio、Realtime、pooler、Storage、ログ用の鍵を対象とする。
4. `SITE_URL=https://tuat-tf.vercel.app`、リダイレクト許可はアプリの `/auth/callback`、`API_EXTERNAL_URL` と `SUPABASE_PUBLIC_URL` は用意する固定HTTPS APIオリジンを設定する。GoogleログインをComposeのauth.environmentで有効化し、Google OAuth client ID/secretと `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://<APIホスト>/auth/v1/callback` を設定する。Google Cloud ConsoleにもそのURIを追加する。既存の大学メール制限はアプリ側に残す。
5. 必ずbaseとlocalの両方を指定する。`docker compose -f docker-compose.yml -f compose.local.yml config --quiet` で構成検証後、同じ2ファイル指定で `up -d`。秘密を展開する `config` の全文を記録しない。`docker compose ps`、ローカルAuth healthとRESTを確認する。先に外部公開しない。

## バックアップと復元リハーサル

`./ops/laptop/backup.ps1` はリンク済みクラウドプロジェクトを読み取り、`.contingency/backups/<日時>/`にSQL3本を作成する。Dockerが必要。既存のJSONスナップショットや週次CSVはAuth込みの完全復元バックアップではない。3回のdumpは単一時点のスナップショットではないので、本番切替用の最終dumpではアプリ・GAS・cron・管理操作の書き込みを全て止める必要がある。

ローカルDBのパスワードだけを `PGPASSWORD` に設定し、`./ops/laptop/restore-local.ps1 -BackupDirectory <バックアップの絶対パス>`。接続先は127.0.0.1:15432に固定され、本番DBには復元できない。ハッシュ不一致・既存アプリデータ・SQLエラーで停止する。roles/拡張機能/マイグレーションの互換エラーは個別に調査し、エラー無視で続行しない。復元中の通知トリガーは無効化される。

復元後、外部公開の前に確認すること:

- `auth.users`、profiles、practice_records、attendances、notes、note_articles、competition_goals等の件数とID、主要レコードを元データと照合する。AuthユーザーIDを作り直さない。
- cron.job、DB webhook、Vault、Edge Functionsを点検。古い `.supabase.co` 宛の通知や同期を実行しない。クラウドとローカル両側から同じGAS／通知処理を走らせない。`send-web-push`とVAPID設定は別途配置が必要。
- 匿名／本人／他人でRLSを検証し、Googleログイン・ログアウト・再ログイン、記録の入力とスプシ同期、ノート写真と個人ノートの非公開、通知を確認する。新しいJWTキーでは既存セッションが使えないので全員の再ログインを想定する。
- **Google Drive連携は現在 `src/lib/google-drive.ts` でSERVICE_ROLE_KEY由来の鍵を使ってトークンを暗号化している。** 新しいSERVICE_ROLE_KEYへ単純変更すると復号できない。切替前に独立した暗号化キーへの互換移行を実装・検証するか、連携利用者の再認証手順を用意する。この準備では暗号化方式を変更していない。
- R2の画像実体は移動不要。R2の設定は維持する。SQLのStorageメタデータだけでは旧Supabase Storage内の実体は復元されないため、旧フォールバックが必要な画像の有無も確認する。

## 本番切替と切り戻し（今回は実施しない）

復元リハーサル完了、固定ドメイン／HTTPS接続確認、上記Google Drive問題解決、必要な設定の個別移管、予備バックアップ確保が開始条件。Vercel環境変数一式をまとめて取得する必要はない。

1. メンテナンス時間を決め、書き込み入口とGAS・cronを停止する。書き込み停止機能はこの準備には含まれないので、停止方法の実装・検証を終えてから進める。
2. 最終dump→空のローカル環境へ復元→件数／ID検証。移行元は保存し、削除しない。
3. named tunnelを接続。Vercelの `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` の3項目だけを切替先に更新し、再デプロイする。R2・GAS等の設定は維持する。Production Readyと認証／入力を確認した後に書き込みと一方だけのジョブを再開する。
4. 期間終了時は再び全書き込みを止め、ローカル期間中の全変更をクラウドに戻す移行を別途検証・実行する。**古いクラウドのURLへ戻すだけでは期間中の投稿が失われる。** 戻し先の既存データにこのローカル専用復元スクリプトを実行しない。
5. クラウドの件数・ID・RLSを確認してからVercelの3項目を戻し再デプロイ。確認後にローカルを停止する。検証済みバックアップを保持し、稼働中の `docker compose down -v` やデータディレクトリ削除は行わない。

公式参照: [Docker self-hosting](https://supabase.com/docs/guides/self-hosting/docker)、[Platformからの復元](https://supabase.com/docs/guides/self-hosting/restore-from-platform)。依存サービスとOAuthを含めて確認するための手順で、現時点では即時切替可能とは扱わない。
