# このPCでSupabaseを一時運用する準備

## 2026-09-08の準備状況

大会の種目編集権限は、部員管理用の一般的な「管理者」ではなく、既存ロール **「システム」** の `manage_system` に紐付いていることを実DBで確認済み。

PCの既存WSL2 Ubuntu 24.04を利用。Docker Engine 29.8.0、Compose 5.5.1、cloudflared 2026.8.3を導入済み。Docker Desktopの導入は不要。外部公開・本番接続先の変更・自動ログイン設定はまだ行っていない。

- 実行用ディレクトリ: Ubuntu内 `/opt/tuat-tf-supabase`。Windows側の `.contingency/runtime` は元のひな形。データはNTFS上ではなくWSLのLinuxファイルシステムに保存する。
- Supabase公式self-hosted/v0.8.0、固定コミット `241bb11c0627f2981746d37033f57dbfa81d29b0`。PostgreSQL 17.6.1.136を使用（移行元と同じメジャー）。Authはv2.196.0、Storageはv1.73.1へ上書き固定。移行元の `/auth/v1/health` と `/storage/v1/version` で現在値を確認した。CLIの `.temp` は古い版を示していたため使わない。
- 独自の鍵を生成済み。Ubuntuの実行ディレクトリはrootのみ、`.env`は600。秘密の表示・Gitへの保存はしない。
- 最終構成の公開ポートはAPIの127.0.0.1:8000だけ。`compose.rehearsal.yml` がDBのポートを解除し、プーラーも非公開。
- `compose.rehearsal.yml`: DB・Auth・Functions等のネットワークはinternal、DBの定期ジョブも無効化。APIゲートウェイだけは別の `local_gateway` ネットワークにも接続し、localhostポートを利用可能にする。DBや関数の本番Webhook・cronを誤実行しない。
- `.contingency/local-app.env`: PCのAPIキーとURL、Google連携用の独立した暗号化キー。R2画像のアップロード・削除を禁止する `IMAGE_STORAGE_READ_ONLY=true` を含む。

ローカル復元とAPI検証まで完了。本番の切替は未実施。外部公開・Google OAuth・通知・最終書き込み停止が残るため、そのまま切替可能とは扱わない。

## 起動・停止・状態確認

PowerShellでリポジトリから実行する。Windowsの管理者権限ではなく、WSL内の既存管理機能を利用する。Dockerグループへのユーザー追加やDocker APIの外部公開は行わない。

```powershell
./ops/laptop/preflight.ps1
./ops/laptop/runtime.ps1 status
./ops/laptop/runtime.ps1 start
./ops/laptop/runtime.ps1 stop
```

`stop`はデータを保持する。`down -v`、データディレクトリ削除、再初期化は通常運用では使用しない。WSLが起動していない間やPCのスリープ・再起動・回線断の間は利用できない。Windows起動時の自動起動、スリープ設定の変更はまだ実施していない。

`runtime.ps1 start`はWSLの終了を防ぐ非表示プロセスを保持する。stopは保存したPIDと専用スクリプトの一致を確認して、その保持プロセスだけを終了する。Windows起動時の自動起動は別途必要。

再構築用に `install-wsl.sh`、`initialize-wsl.sh`、`install-cloudflared-wsl.sh` を保存した。initializeは既存環境を上書きせず停止する。cloudflaredの配布物は公式GitHubのSHA256に照合する。Edge Functionsの初回起動前には `warm-edge-cache-wsl.sh` をWSLのshで実行し、DB/API秘密を持たない一時コンテナで公式mainサービスのJSR依存を取得する。復元環境の通信隔離は解除しない。

PC用アプリの検証は `node ops/laptop/run-local-app.mjs` で起動し、`http://127.0.0.1:3008` を開く。通常の環境ファイルからGAS等の本番設定が混入しないよう、起動時に無効化する。公開URLが埋め込まれた通常の本番ビルドは流用しない。

## バックアップと復元リハーサル

```powershell
./ops/laptop/prepare-backup-wsl.ps1
wsl -d Ubuntu -u root -- bash '/mnt/c/Paimon Dayo/TUAT_TF/ops/laptop/backup-wsl.sh'
wsl -d Ubuntu -u root -- bash '/mnt/c/Paimon Dayo/TUAT_TF/ops/laptop/restore-wsl.sh'
wsl -d Ubuntu -u root -- python3 '/mnt/c/Paimon Dayo/TUAT_TF/ops/laptop/verify-restore-wsl.py'
node ops/laptop/smoke-local-api.mjs
```

prepareはSupabase CLIのdry-runでroles/schema/dataの読み取りコマンドを生成し、接続情報をGit対象外へ保存する。最後に発行した接続情報を共有し、IPv4の公式session pooler（5432）へ接続する。直後にbackupを実行し、有効期限切れは `prepare-backup-wsl.ps1 -RefreshConnection` で再生成する。バックアップはUbuntu内 `/opt/tuat-tf-supabase/backups/<日時>/` にSQL4本とSHA256を保存し、Authユーザーが含まれることを確認する。通常dumpが除外するAuth上のアプリトリガーとStorageポリシーは `managed-schema.sql` に別途取得する。このファイルを省くと新規ユーザーのプロフィール作成や旧Storageの権限制御が欠落する。

restoreはDocker内の `supabase-db` だけが対象。既存の `public.profiles` がある場合は停止する。SHA256、通信隔離、cron停止を検証した後、既存のローカルDBロール `supabase_admin` で1トランザクション復元する（postgresには一部Storage内部テーブルへの権限がない）。失敗時はロールバックし、SQLエラーを無視しない。旧Windowsネイティブ用 `backup.ps1` / `restore-local.ps1` は今回のWSL構成には使用しない。

verifyはAPIテスト前に実行する。テストで作るアカウント・目標は最後に削除するが、Authの監査ログは正しく残るため、テスト後は監査ログの件数が元バックアップと異なる。

3回のdumpは単一時点のスナップショットではない。今回は復元リハーサル用。本番切替前の最終dumpではアプリ、GAS、cron、管理操作の書き込みをすべて止める。週次CSVや以前のJSONスナップショットはAuth込みの復元バックアップの代用にならない。Vault秘密値、Edge Functionの環境変数、Google OAuth設定、R2/旧Storageのファイル実体はDB dumpとは別に扱う。

## Google連携と画像の互換性

`GOOGLE_TOKEN_ENCRYPTION_KEY` に32バイトの16進キーを指定すると、Google連携の暗号化とOAuth state署名にそのキーを使用する。未指定の本番環境は従来の挙動を維持する。PC用設定には、現在のSupabase service-roleキーから導かれる既存の暗号化キーを保存してあるため、PCのservice-roleキーが別でも既存トークンを復号できる。値を会話・ログ・Gitへ出さない。将来Vercelを切り替えるときは、この独立キーを事前に同じ値で設定・検証する。新しいランダム値を指定すると既存トークンは復号できない。

R2の画像実体は移動不要。PCでのテストは画像の読み取りだけに限定する。Google Sheets/GAS・Push等の外向き処理を接続する前に、復元データのURLとジョブを点検する。

## 外部から利用するために残る設定

1. 固定HTTPS APIホスト名を決める。`cloudflared.example.yml` はAPIパスだけを公開するひな形。StudioやDBを公開しない。独自ドメインが未指定のため、トンネルの作成・DNS登録はまだ行っていない。
2. Google OAuthのclient ID/secretと、`https://<APIホスト>/auth/v1/callback` をAuthに設定し、Google Cloud Console側にもリダイレクトURIを登録する。`SITE_URL`・リダイレクト許可・`API_EXTERNAL_URL`・`SUPABASE_PUBLIC_URL`も揃える。大学メール制限はアプリ側に残す。新しいJWTキーなので全員の再ログインを想定する。
3. `send-web-push`のコードは `stage-edge-function-wsl.sh` で配置済み。依存取得とVAPID/Webhook設定、通知実行は未実施。Vault・DB Webhookの旧 `.supabase.co` 宛てを切替先へ合わせる。クラウドとPCで同じ通知や同期ジョブを二重実行しない。
4. AuthユーザーID、主要テーブルの件数・IDとRLSを照合し、Googleログイン、記録入力、スプシ同期、ノートの非公開・画像閲覧、通知を通しで検証する。
5. 最終バックアップ前に書き込み停止の方法を確立する。停止機能の実装・有効化は今回のローカル準備とは別。

## 本番切替と切り戻し

本番切替はこの準備では実施しない。VercelのURL/anon/service-roleの3項目に加え、上の独立したGoogle暗号化キーを揃えて再デプロイする。R2と既存同期設定は必要なものだけ個別に確認する。本番環境変数を一括取得する必要はない。

切替時は全書き込み停止→最終dump→空のPC環境へ復元→データ・権限検証→Vercel変更→Production Ready・認証確認→一方だけのジョブ再開の順とする。期間終了時も書き込みを止め、**PC期間中の全変更をクラウドへ戻してから**接続先を戻す。古いクラウドURLへ戻すだけでは期間中の投稿が失われる。クラウドへの戻し方は別途リハーサルが必要で、ローカル専用restoreを本番へ流用しない。

## 今回の検証記録

- バックアップ: `/opt/tuat-tf-supabase/backups/20260907T180104Z/`。data.sqlは9,927,054 bytes、SHA256 `6599d85c6f583aac4b5244c08be5bd6a7f525feeedd1ddb505582acb3de1e332`。
- 復元直後に72テーブル・22,602行の件数一致、IDを持つ59テーブルの全ID一致。バージョン差による失敗はロールバック後、公式イメージ更新で解消。追加Authトリガー1本・Storageポリシー6本も復元。
- PC側APIで匿名拒否、新規Authユーザーとプロフィール作成、パスワードログイン、一般部員の種目編集拒否、2種目一括保存、未登録種目拒否を確認。一時アカウントと目標は回収済み。
- 既存Google連携1件の暗号化トークンをPC用キーで復号できた。値は表示せず、Googleへの接続・更新もしていない。
- 11コンテナのhealthyとPC用アプリのログイン画面HTTP 200を確認。アプリ側は全200テスト・tsc・対象eslint・build成功。iOS実機とGoogleログインは未確認。
- 停止・再起動後も11コンテナがhealthyに復帰し、Auth/プロフィール各64件・練習記録3,769件、Authトリガー1本・Storageポリシー6本、cron停止が保持された。復元の再実行は既存データ検出で拒否された。

公式参照: [Docker EngineのUbuntu導入](https://docs.docker.com/engine/install/ubuntu/)、[Supabase self-hosting](https://supabase.com/docs/guides/self-hosting/docker)、[Platformからの復元](https://supabase.com/docs/guides/self-hosting/restore-from-platform)。

## 2026-09-08 本番切替依頼後の確認

ユーザーから「一旦このPCに移行して」と切替依頼を受けた。CloudflareのDomains Overviewは登録0件。所有しているドメインの有無を質問中。固定HTTPS URL、Google OAuth、通知/同期の移行、書き込み停止と最終復元、切り戻し検証が未完了のため、Vercelの本番DB接続先は変更していない。Quick TunnelのランダムURLは再起動で変わるため本番認証先には採用していない。

PC版の一般部員テストアカウントで、目標UIの1件編集・新規追加・1件削除と他種目保持を実DB確認した。49人146件の合成表示、種目/部員切替、検索、短距離優先、未保存確認、320px幅の横はみ出しなしを確認。テスト用アカウント/大会/目標/認証ファイルと一時プレビュールートを削除済み。全11コンテナhealthy。目標UIの改善とPC切替の完了は別の状態として扱う。
