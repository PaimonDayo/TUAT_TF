# AGENTS.md — 現行アプリの作業ルール

更新: 2026-10-02。TUAT T&F（陸上部アプリ）を複数端末・複数エージェントで開発するための現行入口。新しいオーナー指示を優先する。

- 開発入口: [README](README.md) / [文書索引](docs/README.md)
- 現在の運用: [PC本番運用](ops/laptop/PC-PRODUCTION-HANDOFF.md)
- 今回の依頼と進捗: [全体監査・改善一覧](docs/REPOSITORY-AUDIT-2026-10-02.md)
- 詳細履歴: [分離前のAGENTS全文](docs/history/AGENTS-2026-10-02.md)

詳細履歴は全件保全してある。履歴中の「承認待ち」「未実装」「最優先」や古い期限は当時の記録であり、新しい指示ではない。着手前に最新の依頼・実コード・最新の完了記録を照合し、実装済み機能を作り直さない。

## 厳守ルール

- `origin/master`を基準にする。作業前に既存の変更・未追跡ファイルを保全し、`git pull`で最新化する。独立worktreeは最新の`origin/master`を取得して始める。diverge時は他人の変更を丸ごと取り込まず、自分の差分を載せ直す。force-pushは禁止。
- 既存の変更を戻さない。独立したローカル作業は担当ファイル・worktreeを分け、本番DB・環境変数・デプロイの変更は同時実行せず担当を一本化する。同名ローカルDBを本番PCの代わりに検証したことにしない。
- 作業ブランチはGitHubへpushしない。関連修正と記録をまとめ、検証後にmasterへ入れるときに1回だけpushする。小さな修正ごとのpushは避ける（2026-09-27確定）。
- 文書だけの変更は手元に保持し、次のコード変更と一緒にpushする。文書更新だけを理由にビルド・デプロイしない。ローカルで終了し、pushを保留したことを報告する。
- Vercel設定（Ignored Build Step・ブランチのビルド停止等）は具体的な変更についてオーナー承認を得る。ビルド代削減方針への同意を設定変更の承認に流用しない。過去の使用量・残額は現在値として扱わない。
- migrationは新しいタイムスタンプで追加し、冪等にする。適用対象・既存履歴・変更内容を確認する。本番初回のmigration・同期・一括更新の前に、対象テーブルのスナップショットとdryRunによる差分確認を必ず行う。
- 公開リポジトリへ秘密値、実ユーザーのデータ退避、未解決の攻撃手順を入れない。秘密値をログ・報告へ出さない。
- コミットの末尾に作業したエージェント自身の`Co-Authored-By`を付け、他AIを名乗らない。Codexは`Co-Authored-By: Codex <noreply@openai.com>`。

## 完了の定義

コードの本番反映は、以下まで確認して完了と報告する。文書のみの場合は上記の保留運用を適用する。

1. `npm run check:environment`で環境差を確認し、`npx tsc --noEmit`・対象eslint・`npx vitest run`を通す。`npm run build`はpush直前に行う。必要な運用テスト・dryRun・UI確認も済ませる。本番稼働中の依存を消さず、必要なら検証用環境を分離する。
2. ローカルの作業ブランチ・worktreeで関連する変更と記録をまとめる。作業ブランチはpushしない。
3. `git fetch origin master`後、masterへfast-forwardして1回だけpushし、`master -> master`を確認する。ff-onlyにならなければ最新の`origin/master`上に自分の差分を載せ直して検証する。force-pushしない。
4. 自分のcommitでVercel Productionが成功したことを確認する。Vercel MCPの`list_deployments`を使い、`target: production`・`state: READY`・`meta.githubCommitSha`の一致を見る。`target: null`のPreviewでは完了ではない。公式GitHub deployment statusを使う場合もProductionの成功と公開`/api/version`のSHA一致を確認する。ビルド中は待ち、失敗は修正する。確認経路が使えず証拠が得られない場合は、その旨を伝えてオーナーに確認を依頼する。
5. commit、masterへの反映、Productionの状態、検証範囲を報告する。iOS PWA・Android等の実機未確認を、ブラウザ合成テストの成功で代替しない。

途中でオーナー判断などが必要になったら、進めた範囲と本番反映の有無を明示する。ブランチ止まり・未適用migrationを本番完了と報告しない。

## 実装の基本

- Next.js 16 App Router / React 19 / Tailwind v4 / Supabase。NextのAPI・規約は学習時と異なり得るため、コードを書く前に`node_modules/next/dist/docs/`の該当ガイドを読む。`params`・`searchParams`・`cookies()`はawait、入口は`src/proxy.ts`、Tailwindの定義は`globals.css`の`@theme`。
- 初期データはServer Componentと`src/lib/queries/`（公開入口`@/lib/queries`）へ集約し、画面に直接Supabase取得を散らさない。操作系はClient Component。互いに依存しないDB取得を直列に積まない。
- `getCurrentUserId()`はセッションのID取得でDBを読まない。`getCurrentProfile()`はプロフィール・ロールをDBから読む。Reactのリクエスト内キャッシュと「DB取得なし」を混同しない。
- UI権限は`permissionsOf(profile.roles)`、DBは`can_*()` / `is_admin()` / `is_staff()`によるRLSで守る。`profile_roles`×`roles`の複数ロールをORで判定する。UIだけを変えて権限を広げない。
- RLSで拒否されたupdate/deleteがエラーなし・0件になる場合がある。重要な更新は`.select()`等で対象件数を確認し、必要な認証更新・安全な再試行後も0件なら明示エラーとする。0件削除を成功にしない。
- 学年は`B1/B2/B3/B4・M1/M2・D1/D2/D3`、`gradeShort` / `GRADE_OPTIONS`を使う。
- UIと部員向け文言は[UI統一](docs/UI-UNIFICATION.md)・[文言規約](docs/WORDING-GUIDELINES.md)を参照する。入力は全画面、選択はシート、編集・削除は共通の「…」メニューを基本に、現在の共通部品を使う。
- `cacheComponents`・`experimental.staleTimes`はiOS PWAの実障害を受けて再導入禁止。PullToRefreshを方式変更だけで復活させない。東京リージョン`hnd1`・画面のReact Queryキャッシュ・`loading.tsx`を維持する。FreezeProbeの診断記録を保ち、削除済みのTab Labを戻さない。
- ガラスUIは2026-10-05の所有者指示で全員の標準表示へ変更する。初回SSR・loading・一般部員プレビューも同じ表示を使い、旧版への切替設定は撤去する。2026-10-03の初期off/端末opt-inは過去の判断。今回のOB戦・戻る・キーボード・操作復旧の本番反映は同日の新しい指示で承認済み。別の全体品質改善は本人用検証の保留を維持する。範囲と結果は[現役生向け運営と本番反映](docs/OB-MEMBER-PRODUCTION-2026-10-05.md)で確認する。
- 下部タブ背景は2026-10-02に直接透過へ統一済み。過去の背景画像化・vendor読込・WebGL制約を現行の要件として戻さない。ガラスを全操作へ広げず、いいね・コメント等は装飾を抑えた現在の方針を維持する。

## 認証・本番PC・予備構成

本番は https://tuat-tf.vercel.app 。操作前に[PC本番運用](ops/laptop/PC-PRODUCTION-HANDOFF.md)を読み、移設・復帰時は[移設手順](ops/laptop/SERVER-HANDOFF.md)・[クラウド復帰条件](ops/laptop/RETURN-TO-SUPABASE.md)の最新注記も確認する。

- ログインはクラウドSupabase（cookie `sb-tuat-auth`）、通常データはPCのWSL Supabase、画像は非公開R2。`src/lib/supabase/cloud-auth.ts`・`server-client-options.ts`の分離と`getClaims`による認証確認を維持する。
- 一時的な認証・通信失敗だけで有効なcookieを消してログアウトさせない。SessionKeepAliveとリダイレクト時のcookie引継ぎを維持する。
- PC停止判定は`pcAvailable()`。`/api/pc-supabase`のクラウド中継と`ops/pc-rest-relay/worker.mjs`の接続先不在時503は`x-tuat-backend: cloud`で切替を知らせる。停止判定には約3分の有効期間があり、瞬時・無停止の切替とは説明しない。
- 新しい表には`20260926050000_failover_change_log.sql`の`zz_log_failover_change`を付けるか、対象外の理由を明記する。`failover_changes`へ変更を記録し、`failover_config.log_changes=true`はクラウドだけ。表を作るmigrationはバックアップ・検証後にPCとクラウドの双方へ適用する。
- `ops/laptop/cloud-mirror.mjs`は5分ごとにクラウド変更をPCへ書き戻し、その後PCの予備データをクラウドへ写す。対象追加時は`TABLES` / `OB_TABLES`、主キー、依存順、書戻し、トリガー副作用を確認する。
- `.contingency/backend/cloud-mirror-state.json`は削除しない。差分比較の要約、通常1日1回のクラウド全件再読込、書戻し失敗行の上書き保護を維持する。
- クラウドの旧cron `sheet-sync-hourly`・`schedule-import-hourly`は停止を維持し、重複書込みを起こさない。Vercel cronは0件。PCの専用S4Uタスク`TUAT PC Jobs`で記録は毎日0時、大会は5分ごと、期限切れ整理は毎日12:17（JST）。予定の自動同期は取りやめ済み。
- PC jobsの失敗・部分成功・結果不明はjournalを保持する。データと履歴を確認せずsuccessへ書き換えたり再送したりしない。プロセス起動だけでなく処理結果と次回実行可能性を確認する。
- DBのWSL実体は内蔵SSDの`D:\WSL\Ubuntu`。中継`run-backend.mjs`が使う`D:\TUAT_TF\node_modules`を検証準備で消さない。全Node終了、WSL停止、Docker volume削除を通常のテスト手順にしない。
- 復帰はURLの差戻しだけで済ませない。鍵・Auth・同期・データ差分を含め現行手順で確認する。古い「PC Auth」前提や特定日付の移設予定をそのまま実行しない。
- 障害切替の確認済み範囲は[9月27日の運用記録](docs/OPERATIONS-2026-09-27.md)と最新の検証記録で確認する。PC電源断・OS再起動、停止中のブラウザ保存から復帰まで、実機・定時実行・24時間比較を、別の試験から確認済みと推定しない。

## 今回の承認範囲と継続方針（2026-10-02）

以下は全体監査への最新回答。承認と実施完了は区別し、実施状況は[全体監査・改善一覧](docs/REPOSITORY-AUDIT-2026-10-02.md)へ記録する。

- 監査済みの改善を検証して本番公開することを承認済み。下書きメニューは従来の作成者・担当ブロック長の閲覧を維持し、`menu_view_all_blocks`による一般閲覧だけ公開済みに限定する。グローバル管理者へ新しい下書き閲覧権限を足さない。
- 未保存変更の破棄確認、AGENTSの履歴分離、大きなコードの責務分割を承認済み。既存動作・データ・権限を維持して検証する。未保存確認をオフライン永続下書きの追加承認とは扱わない。
- GAS旧合体版`gas/combined.gs`は利用状況が不明で使用中の可能性があるため保持する。連携APIの現役ソースは`gas/sync-clasp/Code.js`。
- 新アプリは`D:\TUAT_TF_NEXT_PAUSED`へ移して休止中。明示指示なしに再開せず、現行のビルド・テストへ混ぜない。
- 外部メール監視、予定の自動同期、関東新人の番組取込は取りやめ済み。登録時の旧承認ゲートや旧メニューDBプリセットを、古いバックログを根拠に復活させない。
- ダークモード、記録・つぶやきのオフライン下書き、コメントの@メンションは過去に不採用。新たな明示指示がない限り追加しない。保留案を実装済み・追加承認済みと読み替えない。

## 記録の残し方

- 作業開始時に日付・担当・範囲を対象の日付付き文書へ記録し、終了時に変更、commit、検証、未確認、本番反映の有無を追記する。文書索引へ入口を追加する。
- このファイルは現行ルールと有効な判断だけを短く保ち、詳細な日付ログを積み上げない。新しい判断で規則が変わるときは、その根拠を日付付き文書へ残す。
- [分離前のAGENTS全文](docs/history/AGENTS-2026-10-02.md)の保存領域は書き換えない。旧ログの補足・訂正は新しい記録へ書く。別作業の未コミット履歴も確認して保全する。
