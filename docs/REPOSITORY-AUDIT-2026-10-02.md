# 全体整理の調査と改善（2026-10-02）

## 所有者回答後の追加改善

所有者は、監査済み改善の本番反映、下書きの作成者・担当者限定、記事/フォルダ/役職の未保存確認、AGENTS履歴分離を承認し、次の優先作業として大きなコードの分割を選択した。GAS旧合体版の利用有無は不明で、使用中の可能性があるとの回答のため保持する。

初回の `f12b46f` は明示承認不足としてpushを自動承認レビューが拒否したが、この回答で承認を得た。同時進行のOB戦作業が `f12b46f` を親とする `5148d85` をmasterへ1回pushしたため、初回監査分はOB戦作業と一緒に公開された。追加分はその最新masterへ載せ直し、検証後にまとめて反映する。

- 下書き: `menu_view_all_blocks` を公開済みメニューの条件内へ移す。作成者と担当ブロック長は従来どおり閲覧可能で、全員向け表示設定では範囲が広がらない。グローバル管理者へ新しい閲覧権限は足さない。UIの共通説明・設定説明も一致させる。
- 未保存確認: フォルダ、記事、役職、役職カテゴリを既存の共通確認へ接続。文章以外の写真・公開範囲・編集者・移動先・投票・権限も変更として扱い、保存中は入力と閉じる操作を抑止する。保存失敗時は入力を保持する。
- 履歴: AGENTSの現行ルールを79行へ整理し、旧926行を `docs/history/AGENTS-2026-10-02.md` へ全文保存。相対リンクの移動補正を逆変換した本文のSHA-256一致を確認。後から追加されたOB戦完了記録も追補へ保全する。
- 分割: `ScheduleSheetsManager` は1,078→437行、`ScheduleCard` は793→432行。取り込み状態/通信・CSV/payload変換・プレビュー表示、メニュー編集/公開・出欠表示・並び順補助を責務ごとに6ファイルへ抽出。入口・通信処理・UIの挙動を維持する。
- GAS: 現在のアプリ連携APIのソースと運用テストは `gas/sync-clasp/Code.js` を参照し、10月1日のv21反映記録もある。`gas/combined.gs` は旧アプリ兼用の別コードで、外部利用を否定できない。削除・統合・再配備は行わない。

追加分の検証・本番反映結果は末尾へ記録する。同期復旧、次年度設定、残りの大規模コードは、今回承認された作業との境界を保って後続候補に残す。

## 範囲と判断基準

所有者依頼: 文言・Markdown・機能重複・引継ぎ構造・UIを全体調査し、動作や運用に不利益を増やさない修正は実施。判断が必要な変更・追加機能は最後に相談する。

開始時点は `2c4bd55`。検証中に公開された別作業の `7390e23`（下部タブの直接透過）を取り込み、ガラス描画の変更を保持した。元チェックアウトに別作業の未コミット差分があるため、今回のコードはローカルworktreeへ分離した。

- `rg --files` による全体一覧は915ファイル: src 509、supabase 186、ops 126、docs 60、public 15、ルート12、scripts 4、gas 3。依存パッケージ、生成物、非公開設定、バックアップ、worktreeは対象外。
- Markdown 74件は一覧・見出し・更新/状態・参照を調べ、現行案内・規約・運用文書を実装と照合。完全一致の重複0、既存Markdown相対リンクの切れ0。
- srcのTS/TSX 501ファイルの静的import/export・動的import・型importを調査。参照0候補はopsの利用も再検索した。
- UIは全ルート・部品の横断検索から文言/取得/保存/共通部品の候補を選び、本文と呼出元を確認。全画面を実ユーザーとして操作した監査ではない。
- DBはmigrationの定義を読んだ。今回、本番データ・秘密設定・外部サービスの実体照合は行っていない。履歴migrationは削除対象にしない。

「副作用が絶対にない」という意味ではなく、仕様・権限・保存先・外部通信・運用を変えず検証可能な変更を即実施の対象にした。新旧UIの違いは管理者の端末別opt-inという現行方針であり、無条件統合の対象ではない。

## 今回改善した項目

| ID | 問題 | 改善と根拠 |
| --- | --- | --- |
| F01 | 入力方法の名称が設定・選択欄・案内に重複 | `src/lib/sheet-input-mode.ts` に3方式の名前を集約。`SheetInputModeSetting`、`OctoberSheetSetup`、設定ページで共有。連携方向・旧期間・送信待ち削除の説明は保持 |
| F02 | 直近の画面に「スプシ・同期・反映・GAS」が混入 | 記録設定、コメント削除、メニュー保存、プロフィール、ロール更新、フォーム設定を既存の平易語規約へ統一。コメント・変数・DB値の機械置換はしない |
| F03 | 下書きが本人限定と誤読される | `MenuForm` と `MonthlyPlanningEditorV2` の説明を `src/lib/menu-copy.ts` で共有。「他ブロックのメニューも見る」に下書きも含むことを明記。現行 `can_view_practice_menu()` の権限は変更しない |
| F04 | 検索欄の表示が画面ごとに異なる | 目標・OBの5画面のplaceholderを「検索」に統一。何を検索できるかはaria-labelへ保持 |
| F05 | 予定/メニュー取り込みに同じ表示部品が重複 | Step・RowStatus・SummaryCountを `features/sheet-import/ImportFeedback.tsx` へ集約。入力表・行判定・保存処理は別々のまま |
| F06 | 使われなくなった設定画面が残存 | `SheetRecordFormSetting.tsx` を撤去。現役の入力設定は `OctoberSheetSetup`。利用中のAPIや共通ダイアログは維持 |
| F07 | 旧画像保存方式が現役と紛らわしい | 本番参照0の `avatar-storage.ts` と専用テスト3件を撤去。現役の `api/avatar` → `image-storage` は維持 |
| F08 | JST日付計算の重複・テストの実時計依存 | `todayJST` は既存 `jstToday` へ委譲。同期日時テストの時計を入力日時へ固定。期間・同期頻度・データ操作は変更しない |
| F09 | OB大会キーの直書き7箇所 | queries/ob-entriesを既存 `OB_MEET.meetKey` へ統一。大会・取得条件は同一 |
| F10 | 開発環境の版違いを見逃す | `check:environment` を追加。Node 22.12以降、package/lockの依存宣言、直接依存35件の実インストール版を照合。ネット通信・秘密読取・自動インストールなし |
| F11 | npm testだけでは運用系を確認できない | `test:tooling`、`test:ops`、`test:ops:integration` を追加。最後の入口だけ127.0.0.1で一時HTTPサーバーを使う合成試験。本番運用CLIは実行しない |
| F12 | 旧アイコンルートのexportが型検査エラー | icon-192/512/maskableの通常Route Handlerで、sizeを内部定数へ、未使用contentTypeを撤去。ImageResponseの寸法・画像内容・URLを保持 |
| F13 | READMEのAuth・休止アプリ案内が古い | クラウドAuth・通常PCデータ・クラウド予備の構成へ訂正。別場所へ移した休止アプリを現行packageと案内しない |
| F14 | UI規約が現在の認証や一覧表示を否定 | getClaims/プロフィールDB取得を区別。現役CompactFeedRowと管理者opt-in、PC通知の定期確認を記載 |
| F15 | 通知仕様書の履歴が現在の指示に見える | 冒頭へ現在のコメント/お知らせ/メンション・system_only等を記載。旧設計は履歴と明示、署名・取得入口を現行へ |
| F16 | PC移設文書が旧PC Authを前提にする | 冒頭でクラウドAuthとの違いと旧手順の未再検証範囲を明示。移設の安全性やログイン影響は未検証のまま断定しない |
| F17 | 文言規約の前半と後半が矛盾 | 「記録する」「毎時同期」の例を訂正。フォームエラーと短いトーストの使い分けを明示。共有する説明の置き場所を追記 |
| F18 | 文書入口に現行案内と履歴が混在 | 索引と本報告の機能別入口を追加。AGENTS冒頭に規則の入口と履歴の読み方を追加。既存の承認・障害記録は保持 |
| F19 | 人数一覧の取得失敗が0人に見える | いいね/確認済み一覧にエラー表示と再試行を追加。成功・0件を失敗から区別し、閉じる/対象変更後の古い応答は採用しない |
| F20 | 月送り・人物絞り込みの重複 | shiftMonthをlib/dateへ、人物条件行をFilterRowへ集約。既存表示・クリックを維持 |
| F21 | 絞り込み0件と未登録が同じ表示 | 月間結果・懇親会で条件に合わない場合と全体が空の場合を区別。大会プログラムの空文言も統一 |
| F22 | 長い選択肢でradioのフォーカス枠が縦に伸びる | 入力方法のradio寸法を固定しラベル先頭に配置。行全体で選択できる操作とキーボードは維持 |

## 残る問題と相談が必要な理由

| ID | 優先度 | 対象・根拠 | 次の改善 / 今回広げない理由 |
| --- | --- | --- | --- |
| C01 | 承認後対応 | 表示設定だけで下書きも閲覧できた | 所有者承認により作成者・担当ブロック長限定へ。migration/UI説明を一致させ、両DBを検証する |
| C02 | 高 | `docs/SHEET-SYNC-ERRORS-2026-10-02.md` の停止記録、schedulerの曖昧失敗後停止 | 記録同期の安全な復旧・再試行方針を別途決める。再送はシートの実データを書き換えるので今回の整理に混ぜない。現時点の稼働状態は今回未取得 |
| C03 | 承認後対応 | `NoteEditor`・`NoteArticleEditor`・`RoleManager` にuseFormDraft未接続だった | 共通の未保存確認へ接続。端末への永続下書き保存は既存の不採用方針を維持 |
| C04 | 承認後対応 | AGENTSは開始時点913行、規則入口が416行目、作業ログが645行目だった | 最新926行の履歴を全文保全して現行入口から分離。後追いOB記録も保全 |
| C05 | 一部対応 | `ScheduleSheetsManager` / `ScheduleCard` / `ResultForm` などが大きい | 前2ファイルは責務ごとに分割。746行のResultForm、プロフィール/記録フォーム、FAB等は次の候補 |
| C06 | 中 | `sheet-sync/run`、`schedule-import`、`google-drive`、`competition-program` が各460行超 | 分割候補だが部分失敗、削除防止、期間切替が密接。行数だけで統合しない |
| C07 | 中 | `database.ts` 約2500行、types/index約700行、`ob-entries-db.ts` 手製拡張 | 両DBの適用状態と型の再生成手順を整備。既存未反映migration/types差分を先に区別する必要あり |
| C08 | 中 | TS/GAS/SQLに10月・OB2026が固定 | 来年度・次期シートの管理画面化候補。対象範囲、変更権限、移行方法を相談 |
| C09 | 中 | `SERVER-HANDOFF`・`BACKEND-STATUS`・`POWER-SAVING`・未追跡pc-rest-relay/READMEの旧構成手順 | 冒頭の注意だけでは完全な移設手順にならない。別PCで復旧/切替を通して確認する作業を計画 |
| C10 | 保持 | `gas/combined.gs` と `gas/sync-clasp/Code.js` が併存 | 所有者回答も利用不明・使用中の可能性あり。現行連携APIは後者、旧版の外部利用を否定できないため両方保持 |
| C11 | 低 | 未追跡 `ops/pc-jobs/prepare-monitor.mjs` が存在しないMonitor.js参照 | 廃止済みメール監視の残り。別作業由来のため変更せず、他の旧監視資産とまとめて保管/撤去を判断 |
| C12 | 低 | `getMyObEntryCandidates` が汎用6問い合わせを使用 | 必要なentries/members/historyだけの専用取得に分ける候補。現行の権限・照合を保つ検証が必要 |
| C13 | 低 | NoteComposer/FolderRowActionsの部員取得もerrorを空一覧化 | 編集者候補の失敗表示・再試行を追加する候補。F19と同じ問題だが編集者選択の保存状態を確認してから拡張 |
| C14 | 低 | Note/Venue/Role/OBの保存動詞・処理中表示が分散 | 共通送信ボタンと未保存確認を合わせて段階統一。登録・作成・公開が異なる操作である点は維持 |
| C15 | 低 | OB編集系の複数状態更新・条件・JSXが1行に集中 | 読みやすい整形と関数抽出。大量差分となるため稼働中の別OB作業と分けて実施 |

### Markdownを削除しなかった理由

不要と断定できる完全重複はなかった。日付付き報告は実施理由・SHA・検証限界・復旧の根拠があり、`public/vendor/liquid-glass` の2文書はライセンス・由来として必要。休止中REBUILD/Cloudflare検証は日常の手順から区別するが、未追跡文書もあるため「Gitから戻せる」と決めつけて消さない。

古い「未反映」は日付時点の記録として残す。最新の結果を冒頭/索引で案内する方式と、過去本文を書き換える方式を混在させない。

## 追加機能の候補

| 判断 | 機能 | 目的・負担 |
| --- | --- | --- |
| 今回追加 | 人数一覧のエラー表示・再試行 | 失敗を0人と誤認しない。操作時だけ再取得し常時通信を増やさない |
| 今回追加 | 開発環境診断と運用テストの実行入口 | 後任が同じ依存版で検証できる。本番費用・通信・権限変更なし |
| 今回追加 | 本書の機能別入口 | 関連画面・取得/更新・権限・運用を探しやすくする。コード移動なし |
| 承認後追加 | フォルダ・記事・ロールの未保存確認 | 入力消失を防ぐ。変更がある場合だけ既存の共通確認を表示 |
| 相談 | 同期失敗の安全な復旧支援 | 対象限定の再試行・進捗・未送信の確認。重複送信防止と本番書込みの設計が必要 |
| 相談 | 次年度/次期シートの設定化 | 毎年のコード修正を減らす。管理画面・権限・データ移行が必要 |
| 将来 | DB型/文書リンクのCI診断 | 再発防止。ただしCI費用と実DBへの接続要否を決める |

既存のノート・お知らせ検索、月間結果、OB履歴、投票、通知テスト、取り込みプレビューは重複追加しない。不採用のダークモード、オフライン下書き、コメントメンションは今回再導入しない。

## 機能別の実装入口

| 機能 | 画面/部品 | データ・権限・運用の入口 |
| --- | --- | --- |
| 認証・権限 | login / RoleManager / MemberPreviewSetting | lib/supabase/{cloud-auth,auth,role-catalog}、permissions、menu-permissions、最新migration。運用はops/laptop/PC-PRODUCTION-HANDOFF |
| 練習記録・タイムライン | RecordForm / TimelineView / CompactFeedRow | lib/queries/{feed,records}、record-fields、API record-form-config |
| シート入力設定・連携 | OctoberSheetSetup / SheetInputModeSetting / SystemSyncStatus | lib/sheet-period、sheet-input-mode、sheet-sync/、gas/sync-clasp/Code.js、ops/pc-jobs/README |
| 予定・出欠・メニュー | ScheduleCard / AttendanceToggle / MenuForm / MonthlyPlanningEditorV2 | lib/queries/schedules、menu-permissions、menu-copy、schedule-import、20261001010000のRLS/RPC |
| 大会・結果・目標 | CompetitionProgramView / ResultForm / CompetitionGoalBoard | lib/queries/competitions、competition-program、result-event-presets、ops/pc-jobs |
| OB戦 | ObEntryReview / ObEntryEditor / ObDutyTable | lib/ob-meet、ob-entry-edit、entry-identity、queries/ob-entries、app/(app)/ob-entries/actions |
| ノート・記事 | NotesView / NoteEditor / NoteArticleEditor | lib/queries/notes、ノート各actions・RLS |
| お知らせ・通知 | app/(app)/notices/NoticesClient / NotificationBell / NotificationSettings | lib/queries/notices、supabase/functions/send-web-push、通知migration |
| 共通UI | components/ui/、NewUiSetting、BottomNav | lib/new-ui、glass-*.ts、globals.css、ops/glass、public/vendor/liquid-glass |
| 画像 | ProfileEditForm / features/NoteImages / ui/image-lightbox | app/api/avatar、lib/image-storage、docs/R2-MIGRATION |
| 予備DB・復旧 | アプリ内サービス状態 | ops/laptop/cloud-mirror、backup-backend、PC-PRODUCTION-HANDOFF。旧移設文書の注意を先に読む |

パスはリポジトリルートを基準とし、画面/部品は原則 `src/components/`、libは `src/lib/`。過去の同名資料だけから実行せず、実装と現在の運用を確認する。

## 検証と反映

- Node 24.19.0、Next 16.3.6、ロックと直接依存35件の一致を確認。元チェックアウトはNode 18.17.0と6依存の版違いを検出したので、検証用の依存セットを使った。元の実行環境を勝手に入れ替えてはいない。
- 最新master取り込み後のVitest: 91ファイル・641テスト成功。以前の642から旧未使用画像helperの3テストを撤去、月計算の2テストを追加したため合計641。
- 運用/GAS/ガラス/環境診断の合成52テスト成功。本番のDB・シート・バックアップへ接続しない。
- 最新master取り込み後のNext 16.3.6 production build（合成の本番相当変数・webpack）とTypeScript成功。独立のtsc --noEmitも成功。通常ルートの余分なexportは、この検証で発見・修正した。
- srcと新しい診断スクリプトのeslint: エラー0、既存のログアウト時window.location.assignに警告1。認証を伴う全画面遷移の意味を変えないため保持。
- 設定の3方式: Chrome/WebKit × 320/390/1440px × 文字1/1.5倍 × 新旧UIの24条件成功。現在値と選択名の一致、選択とキー操作、横はみ出しなしを確認。
- いいね/確認済み: Chrome/WebKit × 3幅 × 新旧UI × 2シートの24条件・312回の合成取得成功。成功/空/DBエラー/通信例外/クリック・Enter再試行/対象切替・閉じる競合を検証。外部通信/pageerrorは0。
- 抽出前後のReact表示比較: 取り込み部品28条件・FilterRow12条件でHTML一致。
- Markdown相対リンクとGit差分検査は成功。
- 検証資産は非公開の `.contingency/repository-audit-ui/` に保存。全画面の実ユーザー操作、iPhone/Android実機は未確認。

本番反映結果は完了後に追記する。DB/GAS/PC定期処理と既存の別作業差分は変更しない。


## 初回の公開承認前の記録（履歴）

以下は所有者回答前の記録を保持したもの。現在の承認・反映状況は冒頭と末尾の追加改善記録を優先する。

### 反映状況（2026-10-02）

`f12b46f` をローカルmasterへfast-forwardした。既存の未コミット履歴2文書は退避後に統合して元の未コミット状態へ復元し、その他31ファイルはSHA-256一致を確認した。退避stashと `.contingency/repository-audit-preserve/` も保持している。

本番pushは自動承認レビューが「今回の正確なコミットを本番公開する明示承認がない」として拒否したため未実施。remote masterは `7390e23`、今回の本番反映・Vercelデプロイはない。所有者へ `f12b46f` のmasterへの1回pushを確認する。DB・GAS・PC定期処理の変更は含まない。

所有者への相談は、今回の公開、下書き閲覧範囲、未保存確認、AGENTS履歴分離、追加機能の優先度。詳細は本書のC01〜C15と追加機能表を参照。完了後の文書追記だけでは追加pushしない。

## 追加改善の検証・反映（所有者回答後）

- 最新 `5148d85` を専用worktreeへfast-forward。OB戦の別作業を保持し、最終Vitestは93ファイル・662テスト成功。運用/環境診断の52テストも成功。
- Node24.19.0・Next16.3.6・直接依存35件の一致、最終production build（合成環境変数・webpack）とTypeScript成功。全体eslintはエラー0・既存のログアウト遷移の警告1、変更対象の最終eslintは警告も0。
- 未保存確認はChrome/WebKit・新旧UIで基本48条件（320/390/1440px）、編集項目76条件、部分保存/画像準備28条件の計152条件成功。破棄/続行、無変更/元に戻した入力、保存失敗/通信例外、保存中の閉じる防止、写真/投票/編集者/移動先/権限/色、再openの状態リセットを確認。
- フォルダの新規作成後に編集者保存だけ失敗した場合、再保存で重複作成される既存経路も修正。同じIDへの更新で再試行しINSERTは1回。記事/フォルダとも部分保存後は入力を初期状態へ戻しても確認を維持する。既にDBへ保存された部分を「保存せずに閉じる」で巻き戻す仕様は追加していない。
- 分割した14関数とManager内の状態・通信処理は移動前と一致。合成Reactレンダー64条件でHTML・子へのprops・hook数・effect依存も一致。分割による通信の追加はない。
- `20261002020000_menu_draft_visibility.sql` はPC/クラウドの対象4表・旧関数・ポリシー・復旧SQLを非公開退避後、二重適用と13合成利用者/14メニューのROLLBACKを両側で検証。作成者・全5種類のブロック長・一般部員・管理者・対象者・表示設定・匿名と、メニュー対象者のSELECTも確認。
- 両DBへ1関数のみ適用済み。適用後の関数SHA-256は双方 `86fd16c457ed7ffdd124021f148147ab05368432341a7e163e82aa91ce7ee721`。ロール19件・割当43件・メニュー48件・対象者32件の全データ一致、プロフィール71人不変、合成ユーザー0件、既存ポリシー不変を確認。GAS・PC jobs・認証設定は変更していない。
- 履歴保存領域926行と後追いOB記録4行は、それぞれ元本文とSHA-256一致。再結合すると改行コードをそろえたルート旧AGENTS全930行と一致。不要と断定できない資料・別作業の未反映差分は保持する。
- 検証資産は `.contingency/audit-followup-ui/`、DB退避・復旧・検証は `.contingency/backend/menu-visibility-*`（非公開）。iPhone/Android実機、実ユーザーによる保存/削除は未確認・未実施。

アプリ追加分の公開結果は、masterへの1回pushとVercel・本番表示の確認後に追記する。追加の未決質問はなく、GAS旧版を保持する判断で作業を進めた。

## 2026-10-03 OB戦の閲覧・登録・削除
オーナーの追加依頼で実装。両DB適用・権限/操作のROLLBACK検証済み。公開状況・検証範囲は [作業記録](OB-ACCESS-2026-10-03.md) を参照。
