- 2026-09-08 / Codex / PC試験版ログインのOrigin deniedを修正。ゲートのReferrer-Policy: no-referrerがHTMLフォームPOSTのOriginをnullにする仕様と厳密Origin照合が衝突していた。入口とアプリ応答をsame-originへ変更し、外部サイトへのReferer送信は抑止したまま、同一URL内のフォームOriginを維持。null/欠落/外部Originの拒否は緩和していない。専用ゲートテスト成功、実ブラウザの通常フォームがOriginチェックを通ってパスワード検証へ進むことを確認。ゲートのみ再起動しURL/パスワード/PCデータ/本番は維持、エラー中のユーザータブをGETで開き直した。前回のHTTPテストはOriginを手動指定していてブラウザ挙動を見落としていた。 -> (this commit)
- 2026-09-08 / Codex / 本人限定の別URLでPC試験版を起動。本番は320be2eのまま変更なし。Windows cloudflaredを公式SHA256照合後にworkspace内へ配置し、127.0.0.1:3108の専用ゲートだけをQuick Tunnelで公開。ランダム専用パスワードと12時間Secure/HttpOnlyセッション、JWT本人照合、Origin検証、試行制限、ログアウト/再起動時失効を実装。PC内だけの一般部員「PC試験ユーザー」を作成し、本番アカウントは変更なし。パスワードはGit対象外ファイルへ保存しWindows ACLで本人/SYSTEM限定。アプリは3009と.next-pc-trialへ分離、PC表示/ログアウトを追加。GAS/Google/Push/cron/画像変更/Realtime/SWを止めた。HTTPS経由のログイン・4画面200・REST本人限定・一般部員権限・目標CRUD・refresh・ログアウト後401を検証、テスト目標回収。全201テスト・専用ゲート検証・対象eslint・TypeScript付き専用build成功。専用app/gatewayの停止/再開も実証。依頼は本人限定試験のためmaster/Vercelへ公開せず専用ローカルブランチ保持。詳細ops/laptop/PRIVATE-TRIAL.md。スマホ実機未確認。 -> (this commit)
- 2026-09-08 / Codex / 目標一覧を種目別・部員別の表形式へ変更。名前/種目/目標検索、種目絞り込み、自分のみ、件数、長文展開を追加。本人の右上三点メニューから1件ずつ編集/削除し、一覧内FABから複数種目を追加。新規insertと編集updateを分離し、他種目の意図しない上書きを防止。所属ブロックに応じた種目優先順と手動切替、未保存確認を追加。日付をホーム見出し横へ移し、直近7日間のサマリー見出しを撤去。全201テスト・tsc・対象eslint・build成功。PC版DBで編集/追加/削除と他種目保持を検証、49人146件の合成一覧を390px/320pxで確認（一時ルート/アカウント/データ回収済み）。iOS実機未確認。ユーザーはPCへの本番切替を依頼したが、Cloudflareアカウントにドメインがなく固定公開URLとGoogle OAuth等が未設定のため、本番接続先は未変更。PC側11コンテナhealthy。 -> (this commit)
- 2026-09-08 / Codex / PC代替Supabaseの実環境をWSL2 Ubuntuへ準備。Docker Engine/Compose/cloudflared導入、公式PG17構成に稼働元Auth v2.196.0・Storage v1.73.1を合わせ、独立キーとlocalhost API・DB/Functions隔離・cron停止を設定。DB/Authの72テーブル22,602行と59テーブルの全ID一致を検証。通常dumpが落とすAuthトリガー1本・Storageポリシー6本を別途取得/復元し、新規Authユーザー/プロフィール作成・ログイン・一般部員の種目編集拒否・2種目保存をPCで検証、一時データ回収済み。Google暗号化キーの独立指定と画像読み取り専用ガードを追加し、既存Google連携1件の復号成功。全200テスト・tsc・対象eslint・build成功。種目編集は既存「システム」ロールのmanage_systemであることを実DB確認（権限変更なし）。本番DB接続先/外部公開は未変更。固定ドメイン・Google OAuth・通知/同期・最終書き込み停止・切り戻し検証は残る。詳細ops/laptop/README.md。実機未確認。 -> (this commit)
- 2026-09-08 / Codex / ホームの大会カウントダウンと目標を走行距離と同じ2列・p-4カードへ縮小し、タップで詳細を開く方式へ変更。目標は種目別の入力欄を追加して一括upsert可能にし、選択済み種目の重複を防止。competition_eventsマスタ（一般29種目＋既存入力を保持）を追加し、管理者だけが追加・名称変更・表示順変更・未使用種目削除を実行可能。FKのON UPDATE CASCADEで目標を保持し、使用中種目は削除不可。migration 20260908020000は目標0件のスナップショット/dry-run後に本番適用。全197テスト・tsc・対象eslint・build成功。ローカル390px幅プレビューでカード同サイズと複数種目入力を確認しプレビューは削除。実DBで一般部員の種目追加/更新/削除拒否、2種目同時保存、未登録種目拒否を確認、一時データ回収済み。本番で一時管理者権限を付ける検証は自動承認レビューに拒否され未実施（管理者の成功操作・iOS実機は未確認）。 -> (this commit)

## 2026-09-08 追加機能と一時運用準備

- 2026-09-08 / Codex / ホーム最上部に27大戦カウントダウンと種目別のみんなの目標を追加。既存予定に合わせ初日2026-09-21（初日0日、管理者が日付変更可）、本人だけ編集・種目別一覧、プロフィールの旧目標は保持。ノート写真を1記事6枚までR2へ圧縮保存し、ノートRLSで閲覧/編集を制限、再送時の重複抑制と記事/フォルダ削除後の永続回収キューを追加。migration 20260908010000本番適用済み。全194テスト・tsc・対象eslint・build成功、実DBで他人の編集拒否/匿名不可/非公開写真/同時7件中6件上限/cascadeキュー確認、ローカル本番ビルドから実R2保存/再送/取得/削除成功（一時データ回収済み）。ノートPC用公式PG17構成を.contingency/runtimeへ配置、ops/laptopにpreflight/backup/ローカル限定restore/トンネル例と切替手順を追加。Docker/cloudflared/psql未導入、OAuthとDrive暗号鍵移行・復元リハーサル未実施、本番切替なし。実機UI確認は未実施。 -> (this commit)

# Claude Code 引き継ぎメモ

## 2026-09-04 運用変更

- itoは再実装しない方針となり、アプリコード・設計書・型を削除。migration `20260904090000_remove_ito_feature.sql` で本番のito通知、RPC、Realtime登録、11テーブルも削除する。
- 練習記録は、アプリ保存後の1件write-throughを維持。シート→アプリのpullは毎日0:00 JST（15:00 UTC）の1回だけに変更し、画面表示時pullと通常UIの手動全件pullを撤去。最大100人を1回で扱い、切替時の同期カーソルは0へリセット済み。
- アバター画像は認証済みRoute Handlerが7日間のStorage署名URLを発行し、画像本体はSupabaseから直接配信する。`/api/avatar/image` はroute内で認証するためProxyの二重認証対象から除外。

最終更新: 2026-07-12

## 【最優先・Codexへの引き継ぎ 2026-07-12】iOS実機のフリーズ（/schedule・/timeline）と表示ガクつき

### 症状（オーナー報告・実機iPhone PWA）
1. **FreezeProbe（後述）が /schedule と /timeline で頻繁にフリーズ痕跡を検出**。特に予定タブで「完全に操作不能（タップ・スクロール全滅、アプリ再起動が必要）」が多発。
2. リロード時に**コンテンツが一瞬「上にズレて」表示され、ガクッと正しい位置に戻る**（スクロール位置/レイアウトの復元race）。
3. ローカル再現は**失敗**: 本番ビルド＋Chromium/WebKit＋タッチ合成pull-to-refreshのE2E（`scripts/repro-freeze*.mjs`）では全パス。**実機iOS固有**。

### 最重要の手がかり（まだ誰も検証していない仮説）
フリーズが出る2画面は、**ちょうど react-query キャッシュ機構が入っている2画面**:
- `/timeline` … `PersistQueryClientProvider` + **IndexedDB永続化**（`src/lib/client/query-persistence.ts`、idb-keyval）。iOS SafariはIDBが「復帰後にハングする」既知バグが多い。
- `/schedule` … `ScheduleCachedView.tsx` の useQuery で **queryFn がServer Action**（`loadSchedulePageData`）。Server Actionは直列実行のため、ナビゲーション/refreshと重なると詰まる可能性。
この相関を最初に疑うこと。切り分け案: ①タイムラインのIDB永続化を一時無効化（`QueryProvider.tsx`で`PersistQueryClientProvider`→素の`QueryClientProvider`に切替）した検証ビルドをオーナー実機で試す ②scheduleのqueryFnをServer Action→Route Handler(fetch)に変える。

### 証拠収集の仕組み（実装済み・活用すること）
- `src/components/features/FreezeProbe.tsx`（(app)layout常駐）: 1秒心拍をlocalStorageへ。異常終了は次回起動時に検出し、**localStorage `tuat-freeze-reports` に直近5件**（at/path/foundAt）保存＋can_manage_system保持者にトースト表示。
- 拡張候補: 直前のタッチ対象・開いていたdialogの有無・performance.memoryを心拍に含めると原因特定が速い。オーナーは非エンジニアなので「レポートを画面から見られる/送信できる」導線もあると強い。

### ガクつき（症状2）の調査ポイント
- Next.js 16 cacheComponents(PPR)のstatic shell→動的コンテンツstream時のスクロール位置復元。`Header large`のcollapse挙動や`scroll-behavior`、`history.scrollRestoration`を確認。
- 再現はローカルWebKitでもできる可能性が高い（見た目の問題なので）。`scripts/repro-freeze-webkit.mjs`を流用しスクリーンショット連写で確認可。

### やってはいけないこと（今日の教訓・再発防止）
- `PullToRefresh.tsx`に`useTransition`を再導入しない（isPendingが解消せず固まる回帰を今日起こした。46e79a7→cb0278aの経緯参照）。
- `next.config.ts`に`experimental.staleTimes`を再導入しない（cacheComponentsと併用の実験的組み合わせ。撤去済み）。
- `vercel.json`の`"regions": ["hnd1"]`を消さない（消すと関数が米国東海岸に戻り全画面が数秒級に劣化。今日の最大の改善）。
- 同期・一括更新はスナップショット＋dryRun必須（AGENTS.md厳守ルール）。

### E2E再現ツール（今日整備済み）
- `npm run build && npm run start`（:3000）→ `npm i --no-save playwright`（＋WebKitは`npx playwright install webkit`）→ `npx tsx --env-file=.env.local scripts/repro-freeze.mjs`（Chromium/Edge）または `repro-freeze-webkit.mjs`（WebKit・タッチ合成pull込み）。
- ⚠️ 本番authに使い捨てユーザーを作成する（finallyで削除）。**実行前にオーナーの許可を取ること**（2026-07-12に許可実績あり）。

### 本日の変更履歴（コンテキスト）
AGENTS.md作業ログの2026-07-12各行を参照。要点: 東京リージョン固定（体感大幅改善・オーナー確認済み）／同期の型不一致スキップ＋3日分滞留解消／staleTimes撤去／PullToRefreshのリスナーをタッチ中のみ登録／スプシ由来記録はcreated_at=練習日0時JST（migration 20260712150000でバックフィル済み）。

## 現在のアクティブ実装バックログ

**`AGENTS.md` の「実装バックログ（2026-07-03）」を正とする。** 2026-07-03 の全体コードレビューでオーナーが採否を確定した（承認ゲート廃止・スプシ同期の方向固定・タイムライン表示方針ほか）。番号順に着手すること。

（参考）2026-06-29 時点では過去方針の未完了タスクをすべてリセットしていた。

- `TASK-codex.md`、`QA-CHECKLIST.md`、`UI-UNIFICATION.md`、`UX-ISSUES-2026-06.md` 内の未チェック項目は履歴・確認観点であり、現在の実装指示ではない。
- 下記の「実機で確認すること」も過去の引き継ぎ記録であり、自動的に実装バックログへ戻さない。
- 次の実装は、最新コードを確認したうえで新しいユーザー指示から定義する。

## 記録フォーム編集・画面更新・承認導線・同期操作（2026-06-29）

- マイページの小型項目設定を、実際の記録フォームを模した全画面エディタへ変更。
- 追加項目はドラッグ並べ替え、名称・文章/数値形式の変更、追加、削除が可能。標準項目は固定して保存ロジックを保護。
- カスタム項目は、アプリ上の項目名とスプレッドシート列名が完全一致する場合だけ双方向同期。スプレッドシートの列名は変更しない。
- 認証後の全画面と承認待ち画面へPull-to-refreshを追加。
- 承認待ちがいる場合、ホーム最上部に人数付きの承認導線を表示。
- 管理者の手動同期を、確認画面なしの「スプレッドシートと同期」1タップ操作へ変更。同期処理側の非破壊・競合スキップは維持。
- 確認済み: `npx tsc --noEmit`、変更ファイルのESLint、`npm run build`。

## 表示高速化・ロール別通知・リアルタイム未読バッジ（2026-06-29）

- `getCurrentProfile` をReactリクエストキャッシュ化し、レイアウト・ヘッダー・ページ間の重複DB取得を排除。
- ホームを承認待ち、お知らせ、週間集計、予定、ノート、タイムライン単位のServer Component＋Suspenseへ分割。遅いセクションを待たず、取得済み部分から表示する。
- マイページの設定内容と記録フォーム編集（D&D依存）を設定展開時まで遅延ロード。
- タイムライン、つぶやき、承認待ち、お知らせ、ロール所属検索用のDBインデックスを追加。
- お知らせ通知先を「全員／複数ロール」に対応。対象者の通知設定、承認状態、在籍状態を尊重し、複数ロール一致でも1件だけ生成。
- ヘッダーのベルをSupabase Realtime購読へ変更。通知追加・既読変更時に未読件数を再取得し、赤丸を即時更新。
- 本番適用済みマイグレーション: `20260629120000_role_notice_notifications_and_performance.sql`。
- 確認済み: `npx tsc --noEmit`、変更ファイルのESLint、`npm run build`、Local/Remote migration一致。

## システム管理権限と自己投稿通知（2026-06-29）

- ロール権限へ `can_manage_system`（システム管理）を追加し、組込「管理者」へ初期付与。
- システム管理権限者がお知らせを投稿した場合だけ、投稿者本人にもアプリ内通知・Web Pushを生成。通常投稿者の自己通知除外は維持。
- 通常の部員管理者による権限昇格を防ぐため、システム管理フラグの変更、同権限ロールの割当・解除・削除をDB関数とトリガーで保護。最後のシステム管理者は解除不可。
- 本番適用済みマイグレーション: `20260629130000_system_management_permission.sql`。
- 本番確認: 組込管理者 `can_manage_system=true`、割当1名、対象プロフィールは承認済み・在籍・お知らせ通知ON・Push購読1件。
- 確認済み: `npx tsc --noEmit`、変更ファイルのESLint、`npm run build`、Local/Remote migration一致。

## UI改善4点（指示書 docs/TASK-claude-ui-2026-06-21.md）— Claude実装・push済み

コミット `86a279b`。`npx tsc --noEmit` は当該コミット単体でクリーン
（フルビルドはCodexのスプシ取込WIPが作業ツリーに同居していたため未実行）。

- **キーボード対策**: `FullScreenContent` を `visualViewport` 追従（`useSyncExternalStore`）にし、
  キーボード表示中もヘッダー(閉じる)・スクロール・フッター(投稿)が可視領域に残る。全FormModal共通。
- **カード安定化**: `RecordCard`/`TweetCard` の compact/詳細で **padding を変えず**横ズレを解消（縦余白と内容のみ変化）。
  `HomeFeed` は展開後に **「閉じる」** で畳める（カード内のいいね等で誤って閉じない）。
- **簡易表示の保持**: タイムラインの compact を **cookie** 化し、`timeline/page.tsx` がSSRで復元
  （詳細→簡易のフラッシュ防止）。`initialCompact` prop を追加。
- **ノート記事の枠内展開**: `NoteArticleList`（新規）でフォルダ内の記事をその場で開閉。
  長文（600字超）は「全文を表示」で記事詳細へ。`notes/[id]/page.tsx` を差し替え。
- **上部寸法の統一**: 予定タイトルを **「予定」** に変更。`SegmentedControl` に `min-h`、
  予定/タイムライン/ノートの絞り込み行を `px-4 pt-1 pb-3` + `flex min-h-9 items-center` に統一。

> 注: 実装時、`types/index.ts` / `ScheduleSheetsManager.tsx` / `api/schedule-sheets/preview/route.ts`
> はCodexの未コミットWIP（編集可能プレビュー）だったため触れていない。これらは別途Codexが完成させること。

## スプレッドシート取込の編集可能プレビュー（タスク3）

- 実装コミット: `5ec6102` 予定取込プレビューを編集可能に
- CSV/Googleスプレッドシートの全行を横スクロール可能な編集表で表示。
- 列は位置ではなくヘッダー名からマッピング。
- 行状態は`追加 / 更新 / エラー / スキップ / 未確認`。
- エラー行には行番号と具体的な理由を表示。
- セル変更後は未確認となり、同じAPIでサーバー再検証する。
- 反映時にも最新内容を再検証し、正常行だけをRPCへ渡す。
- エラー行は画面に残し、修正後に再取込できる。
- 大会・記録会のCSVテンプレートへ場所・対象ブロック・詳細を追加。
- 検証処理は`src/lib/schedule-import.ts`へ集約。

確認済み:

- `npx tsc --noEmit`
- 変更ファイルのESLint
- 正常行、時刻エラー、対象月エラー、修正後再検証の直接テスト

実機で確認すること:

1. GoogleスプレッドシートURLとCSVの両方で全行が表に出る。
2. エラーセルを修正し、再確認後に追加/更新へ変わる。
3. 正常行とエラー行が混在する状態で正常行だけ反映される。
4. 反映後にエラー行だけが残り、修正して再反映できる。
5. 狭い画面で横スクロールでき、ページ全体が横へ崩れない。

## お知らせのホーム表示・リアクション

- 実装コミット: `4f501eb` お知らせのホーム表示とリアクションを刷新
- ホーム表示ルール:
  - 重要(`pin_home=true`)は件数制限外ですべて表示し、本文まで展開。
  - 通常のお知らせは直近3件をタイトルのみ表示。
  - 締切が翌日のお知らせは直近3件に含まれなくても追加表示し、
    `明日締切`バッジを付ける。
  - 期限切れのお知らせはホームに表示しない。
  - 通常カードまたは重要カードのタイトルから`/notices#notice-<id>`へ移動。
- リアクション:
  - `確認 / ありがとう / 質問あり`の3種類。
  - 1人が複数種類を付け外し可能。
  - お知らせ一覧とホームの重要お知らせに表示。
  - `notice_reactions`を追加し、本人だけがINSERT/DELETEできるRLSを設定。
- マイページ:
  - 重複していた「自分のノート」導線を削除。自分のノート操作はノートタブへ集約。
- 適用済みマイグレーション:
  - `20260621160000_notice_reactions.sql`
  - `supabase migration list`でLocal/Remote一致を確認済み。
- 注意:
  - 「前日リマインド」は現状、ホーム上の`明日締切`表示。
  - OS/PWAのプッシュ通知やメール送信は未実装で、別途通知基盤が必要。

確認済み:

- `npx tsc --noEmit`
- 変更ファイルのESLint
- リアクションテーブルの本番DB存在確認
- 匿名ユーザーからリアクション行が見えないことを確認

実機で確認すること:

1. 通常3件＋重要全件＋明日締切の例外表示が重複しない。
2. ホームから対象のお知らせ位置へ移動できる。
3. 3種類のリアクションを付け外しでき、再読み込み後も件数が維持される。
4. 重要お知らせの確認済み操作が従来どおり機能する。

## ノートの記事リスト化（タスク2）

- 実装コミット: `ff708c1` ノートをフォルダと記事の形式へ刷新
- `docs/NOTES-PLAN.md` をフォルダ＋記事形式へ全面改訂。
- データ構造:
  - 既存の `notes` をノートフォルダとして利用。
  - `note_articles` を追加し、フォルダ内に複数の記事を保存。
  - 既存 `notes.body` は同じタイトルの最初の記事へ自動移行。
  - 本番データは3フォルダ・3記事へ移行されたことを確認済み。
  - `note_themes` は旧データ互換のため残すが、新UIでは使用しない。
- 画面:
  - `/notes`: 共有/個人のフォルダ一覧。記事数と作者を表示。
  - `/notes/[id]`: フォルダ情報と記事一覧。
  - `/notes/[id]/articles/[articleId]`: 記事本文の表示・編集・削除。
  - フォルダ内FABは、権限確認後にそのフォルダの記事作成を直接開く。
  - ホームと部員詳細のノート表示もフォルダ名＋記事数へ更新。
- 権限:
  - 共有/個人の両方で `全員 / 指定者 / 作者のみ` を設定可能。
  - 記事のSELECT/INSERT/UPDATE/DELETEは親フォルダの
    `can_view_note` / `can_edit_note` をRLSで継承。
  - フォルダ設定とフォルダ削除は作者または管理者のみUI表示。
  - 匿名ユーザーの `can_edit_note` が `false` になることを確認済み。
- 適用済みマイグレーション:
  - `20260621120000_note_articles.sql`
  - `20260621121000_secure_note_edit_access.sql`
  - `supabase migration list` でLocal/Remote一致を確認済み。

確認済み:

- `npx tsc --noEmit`
- ノート関連変更ファイルのESLint
- `npm run build`
- 本番DBの移行件数確認
- 匿名編集判定の拒否確認

実機で確認すること:

1. 共有・個人フォルダを作成し、複数記事を追加できる。
2. 記事を編集・削除して一覧へ正しく戻る。
3. 個人フォルダを「全員」または「指定者」にして、別ユーザーが記事を操作できる。
4. 作者以外にはフォルダ設定・フォルダ削除が表示されない。
5. 下書きフォルダが権限のないユーザーには表示されない。

## 文脈FABの実機手直し（タスク1.1）

- 実装コミット: `67e7934` FABの実機不具合を修正
- `/notes` の共有フォルダ一覧上部に「フォルダを作成」を追加。
  - 既存の `FolderForm` を全画面 `FormModal` で開く。
  - 保存後はモーダルを閉じて `router.refresh()` で一覧を更新する。
  - 空状態とノートエディタ内の案内文も新しい導線に合わせた。
- Speed Dial:
  - コンテナを最大15remのレスポンシブ固定幅にした。
  - 3項目を `w-full` にして等幅化し、`whitespace-nowrap` は維持。
- 予定/お知らせ/ノートのFAB:
  - `scale(0.92) -> scale(1)` のアイコンアニメーションを削除。
  - タブ切替時に位置・サイズが動かず、即時にアイコンだけ差し替わる。

確認済み:

- `npx tsc --noEmit`
- `npx eslint src/components/layout/FAB.tsx src/components/features/NotesView.tsx src/components/features/NoteEditor.tsx`

実機で確認すること:

1. 共有フォルダ一覧からフォルダを作成し、保存直後に一覧へ表示される。
2. Speed Dialの3項目が狭い端末でも同じ幅かつ1行で表示される。
3. 予定・お知らせ・ノートへ切り替えた際、FABアイコンが拡大・移動しない。

## 文脈FAB（タスク1）

- 実装コミット: `e889516` 文脈に応じたFABへ刷新
- ホーム/タイムライン:
  - FABはアクセント色の `＋`。
  - タップで「練習記録 / つぶやき / 大会・記録会の結果」の3行Speed Dialを表示。
  - 各項目は1行・内容幅・絶対配置で、通常レイアウトを押し広げない。
  - 展開中だけ `＋` を45度回転して閉じる表示にする。背景タップでも閉じる。
- 予定:
  - 権限保持者には `CalendarPlus` のFABを表示し、種別選択なしで予定フォームを開く。
- お知らせ:
  - 権限保持者には `BellPlus` のFABを表示し、種別選択なしでお知らせフォームを開く。
- ノート:
  - 共有フォルダ選択を `?folder=<id>` と同期。
  - フォルダ内では `NotebookPen` のFABを表示し、そのフォルダを初期選択したノート作成フォームを開く。
  - 「フォルダ未設定」は実体フォルダではないためFABを表示しない。
- 画面遷移:
  - FAB本体をpathname＋queryのキーで再マウントし、Speed Dialとフォーム状態を確実にリセット。
  - マイページ等の既存 `?compose=1` 導線は維持し、閉じると `router.back()` で元画面へ戻る。
- アニメーション:
  - 直接作成タブは色を変えず、アイコンの短いscale差し替えのみ。
  - `prefers-reduced-motion` では差し替えアニメーションを無効化。

確認済み:

- `npx tsc --noEmit`
- 今回変更箇所のlintエラーなし
- 全体 `npm run lint` は既存の `src/components/features/TimelineView.tsx:44`
  (`react-hooks/set-state-in-effect`) 1件のみ失敗。Claude担当範囲のため未変更。

実機で確認すること:

1. ホーム/タイムラインのSpeed Dialが狭い端末でも折り返さない。
2. 予定/お知らせ/ノートのFABが直接フォームを開く。
3. ノート作成フォームのフォルダ初期値が、開いていた共有フォルダと一致する。
4. Speed Dialを開いたまま下タブを切り替えると閉じた状態へ戻る。

## Google Drive / Sheets 連携

- Google Drive OAuth と予定シート自動発行を実装済み。
- 関連コミット:
  - `2401065` Google Drive連携と予定シート自動発行を追加
  - `927b81e` Drive連携時の再ログイン導線を修正
  - `0322834` シート発行に曜日別の時間と場所設定を追加
- Supabase マイグレーション
  - `supabase/migrations/20260620121000_google_drive_connections.sql`
  - 本番DBへ適用済み。
- OAuthトークンは `google_drive_connections` に暗号化して保存する。
- OAuthスコープは `openid email drive.file`。アプリが作成したファイルだけを扱う。
- 作成したスプレッドシートは、連携した利用者本人のマイドライブへ入る。
- OAuth開始は `/api/google/connect` への明示的なPOSTだけで行う。GETは予定画面へ戻す。
  ブラウザの履歴復元やURL直開きで認可画面へ飛ばないための対策。

## Google Cloud 構成

- 既存のGoogleログイン用プロジェクトとDrive連携用プロジェクトを分離した。
- Drive連携専用プロジェクト:
  - Project ID: `tuat-track-drive-2026`
  - Google Drive API: 有効
  - Google Sheets API: 有効
- OAuthクライアントのリダイレクトURI:
  - `http://localhost:3000/api/google/callback`
  - `https://tuat-tf.vercel.app/api/google/callback`
- OAuth JSONはリポジトリに含めない。
- ローカルでは `.env.local` の `GOOGLE_DRIVE_OAUTH_CREDENTIALS_PATH` からJSONを読む。
- Vercel Productionには次を設定済み:
  - `GOOGLE_DRIVE_CLIENT_ID`
  - `GOOGLE_DRIVE_CLIENT_SECRET`
  - `GOOGLE_DRIVE_REDIRECT_URI`
  - `SUPABASE_SERVICE_ROLE_KEY`
- 新プロジェクトへの切り替え後、本番を再デプロイ済み。

## 連携確認

- 大学アカウント `s253013u@st.go.tuat.ac.jp` の接続レコードが本番Supabaseに保存されることを確認済み。
- 途中でOAuthコールバックが `supabaseKey is required` になったが、Vercel Productionの
  `SUPABASE_SERVICE_ROLE_KEY` を再設定して解消した。
- 本番URL: `https://tuat-tf.vercel.app`

## 曜日別の時間・場所設定

練習予定の新規シート発行時に「曜日ごとの時間・場所」を設定できる。

- 設定欄は発行セクション内の `Disclosure`。通常は閉じている。
- 初期値:
  - 月曜 `17:00`
  - 水曜 `17:00`
  - 土曜 `09:00`
- 日曜から土曜まで個別に設定可能。
- 時間だけ、場所だけ、両方、どれも未設定、すべて対応。
- 場所は `venues` の登録内容から選択する。
- 空欄の項目は発行したシートでも空欄になる。
- 既存予定を編集用シートとして発行する場合は、既存予定の値を優先し曜日設定は使わない。
- APIは曜日 `0..6`、時刻 `HH:mm`、場所名の長さを検証する。

主な変更箇所:

- `src/components/features/ScheduleSheetsManager.tsx`
- `src/app/api/google/sheets/create/route.ts`
- `src/lib/google-drive.ts`
- `src/types/index.ts`

## 検証状況

`0322834` の変更について以下は成功済み。

- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- GitHub `origin/master` へpush済み
- Vercel Productionのデプロイが `Ready` であることを確認済み

## 次に確認すること

実端末で新規練習シートを1枚発行し、次を確認する。

1. 月曜と水曜に `17:00`、土曜に `09:00` が入る。
2. 選択した曜日の場所が該当日へ入る。
3. 時間だけ・場所だけの設定がそれぞれ反映される。
4. 発行したシートを編集後、プレビューとインポートが通る。

問題が出た場合は、Vercelの `/api/google/sheets/create` のログと、Google Sheets APIの
レスポンスを最初に確認する。
# ノート編集・フォルダ説明・メニュー対象者プリセット（Codex・2026-06-21）

- 実装コミット: `3a63fd1` ノート編集とメニュー対象者プリセットを改善
- ノートの固定フッター登録をポータル方式へ変更し、入力中の再描画で保存ボタンが不安定になる問題を修正。
- フォルダ設定の編集導線を非表示ボタンのDOM操作から、直接 `FormModal` を開く方式へ変更。
- `notes.description` を追加し、フォルダ作成・編集、一覧、詳細表示へ反映。
- 適用済みマイグレーション: `20260621220000_note_folder_description.sql`
- 練習メニューの新規作成時、直前に対象者指定で保存したメニューの対象者を初期選択。
- 対象者プリセットをユーザー別 `localStorage` 保存へ変更。既存DBプリセットは初回だけ端末へ移行。
- 前回選択したプリセットを次回作成時に復元。プリセット名・対象者の上書き編集と削除に対応。

確認済み:

- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- `supabase migration list` で `20260621220000` のLocal/Remote一致

# 統一感バックログ #4〜#13（Codex・2026-06-21）

- 実装コミット: `6455a05` UIと操作の共通基盤を統一
- `src/components/ui/toast.tsx` を追加し、`alert()` と無表示だった削除・並べ替え失敗を共通トーストへ統一。
- `src/components/ui/select.tsx` を追加し、予定・練習メニュー・スプレッドシート設定の生 `<select>` を置換。
- 結果・お知らせ・ロール権限の独自スイッチを共通 `Toggle` へ統一。
- `FormModalFooter` を追加し、主要フォームの主送信ボタンを全画面モーダルの固定フッターへ移動。
- `src/hooks/use-feed-display.ts` を追加し、ホーム・タイムライン・マイページの簡易表示と個別展開を共通化。
- ホーム・マイページ・部員詳細・スプシ編集対象の空表示を `EmptyState` へ統一。
- 予定・ノート・ノート記事の更新処理も `safeUpdate` / `safeUpdateMessage` へ統一。
- `SubHeader.backLabel` を撤去。会場アクセス・プロフィール目標へ `Linkify` を適用。
- 未使用だった `ScheduleComposer` / `NoticeComposer` を削除。
- 更新後の再描画方針を `docs/UI-UNIFICATION.md` §4.5 に明文化し、`docs/CONSISTENCY-AUDIT.md` を完了状態へ更新。

確認済み:

- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- 2026-09-08 / Codex / みんなの目標をアプリ共通の全体・中長距離・短距離タブへ統一。種目別/部員別モードと種目優先順の切替を撤去し、タイムライン/部員一覧と同じ所属ブロック判定で絞り込む。種目ごとの表、検索、種目絞り込み、自分のみ、三点編集削除、FAB追加は維持。取得時と保存直後の目標に所属情報を含め、種目順はシステムの設定順へ統一。共通SegmentedControlにtypeとaria-pressedを追加。全201テスト・tsc・対象eslint・PC専用build成功。PCアプリだけ再起動し、同じHTTPS URLで3タブ切替をブラウザ確認（目標0件のため実データ混在表示は未確認、共通判定は既存テスト確認）。URL・入口セッション・データは維持。本人限定試験のため専用ローカルブランチのみ、本番公開なし。 -> (this commit)
- 2026-09-08 / Codex / ホームを見出し→お知らせ→大会カウントダウン/目標カードの順へ変更。PC試験版だけ再ビルド/再起動し、同じHTTPS URLで表示順を確認。対象eslint・TypeScript付き専用build成功。Vercel課金済みとの申告を受け、Vercelにアプリを残しDB/AuthだけPCで代替する構成と残作業をops/laptop/README.mdへ追記。Vercel使用量は未取得、本番接続先・公開設定は未変更。 -> (this commit)
