<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Current implementation status (2026-07-12; supersedes stale backlog notes below)

- **Weekly backup (former task 13) is complete**: `/api/backup` and the GAS weekly Google Drive job are deployed. The owner has manually run and verified a saved backup; `attendances` is included.
- **P2, P5, and P6 are complete**: timeline pagination uses composite cursors, obsolete `getFeed` filter arguments were removed, and sheet-member refresh now runs after My Page/own-member rendering.
- **Tab freeze incident is RESOLVED (2026-07-12)**: 原因は`cacheComponents`。b3698c5で無効化しオーナー実機確認済み。タイムラインのIndexedDB永続化は`c5786a9`で停止したまま（フリーズとは無関係と判明したが、再導入は必要になったときに）。詳細は下の解決済みインシデント節。
- **Home attendance is local-only**: changing attendance does not call `router.refresh()` or reload the page; the home initial state uses one coherent skeleton.
- **Remaining candidates**: sync scalability at 100 members, sync-failure/mismatched-sheet visibility, search (explicitly deferred by owner), generated database types, and sheet bulk-input workflows. Use this section and the actual code over older “unstarted” labels below.

## 【解決済み 2026-07-12】iOS PWAのホーム遷移フリーズ → 原因は cacheComponents

**b3698c5（`next.config.ts`の`cacheComponents: true`無効化）で解消。オーナーが実機で「問題ない」と確認済み（2026-07-12）。**
- 教訓: 有効化（60d6175, 07-12 00:14）と同日に全症状（他タブ→ホーム毎回フリーズ・予定/タイムラインのフリーズ・リロード時ガクつき・もっさり）が始まり、無効化で消えた。**`cacheComponents`と`experimental.staleTimes`は再導入禁止**（少なくともNext 16.2.9 + iOS PWAの組み合わせでは危険）。
- タブ切替速度は ①Vercel関数の東京リージョン固定（vercel.json、削除禁止） ②各画面のreact-queryセッションキャッシュ ③loading.tsx で担保。
- 調査資産: Tab Lab（/tab-lab、システム管理者のみ導線）とFreezeProbe（フリーズ痕跡の記録・トースト）は当面残す。
- 以下は当時の調査記録（履歴として保持）:

### （履歴）調査経緯

- **現在の実機症状**: 予定など別タブからホームへ移動しようとすると毎回固まり、ホームへ戻れない。フリーズ、もっさり、スクロール時の構造崩れ、リロード時の配置ガクつきも報告あり。**解消したと扱わないこと。**
- `c5786a9`: タイムラインのIndexedDB永続化を停止。**ホーム遷移フリーズは解消せず**、IDB主因仮説は外れた。
- `e2f2497`: 予定のServer Action queryFnをキャンセル可能なRoute Handlerへ変更、BottomNavの手動・touch prefetchを撤去、PullToRefreshをレイアウトから停止、予定スケルトンを現UIへ合わせた。直後の短時間確認ではエラーなしとの報告だったが、後続の反復実機確認で**他タブ→ホームが毎回フリーズ**。成功ではない。
- `26ad026`: PullToRefreshをpassive・preventDefaultなしで再導入したところ、フリーズ・もっさり・ガクつきが全面再発。`18c948f`で即撤回。PullToRefreshは症状を悪化させることは確認できたが、撤去後もホーム遷移フリーズは残るため**単独の根本原因ではない**。
- **現在の本番状態**: PullToRefreshは未マウント、タイムラインIDB永続化なし、BottomNavの追加手動prefetchなし、予定再取得はRoute Handler。それでもホーム遷移フリーズは未解決。
- **禁止**: PullToRefreshを方式変更だけで再導入しない。IndexedDB・prefetch・Server Actionのいずれかを「根本原因」と断定しない。ローカルE2E成功やbuild成功を実機障害の解消扱いにしない。
- **次の調査**: `/home`遷移時のRSC要求開始/完了、Client Router状態、PPR/Suspense、保持中ルートとメモリ、メインスレッドlong taskを実機で採取する。推測ベースのキャッシュ微修正を続けず、まずホーム遷移そのものの証拠を取る。
- **2026-07-12 Fable 5の切り分け**: 消去法と時系列で **`cacheComponents: true`（PPR Router層）が最有力**と判断し無効化を実施。根拠: ①有効化は2026-07-12 00:14（60d6175）で、全症状は同日から（それ以前はタブ切替一瞬・フリーズ無し） ②Tab Lab実測でRouterを通さない実DOM再構築は安定＝残る容疑はRouter層のみ ③IDB・Server Action・prefetch・PullToRefresh・staleTimes全撤去でも再現 ④`"use cache"`等の依存コード無しで無効化はコンフィグのみ。無効化ビルドでtsc/build/WebKit E2E（他タブ→ホーム含む）全パス。**実機での最終判定はオーナー確認待ち。これで直っても「解消」と書く前に必ず実機確認を取ること。**

# まずこれを読む（エージェント共通の入口）

> このファイルだけ読めば着手できるようにしてある。各リンク先は必要なときだけ開けばよい。
> Next.js 16 固有の注意は上のブロック参照（`middleware.ts`→`src/proxy.ts`、`params`/`searchParams`/`cookies()` は await 必須、Tailwind v4 は `globals.css` の `@theme`）。

## このアプリ
TUAT T&F（陸上部アプリ）。Next.js 16 (App Router) + React 19 + Tailwind v4 + Supabase(@supabase/ssr)。本番 https://tuat-tf.vercel.app 。
複数端末・複数AI（Claude Code / Codex）で **同じ origin/master を共有して開発** している。

## 厳守ルール
- **origin/master が正。force-push 厳禁。作業前に必ず `git pull`**（diverge時は丸ごとマージせず自分の差分だけ載せ直す）。
- マイグレーションは **新しいタイムスタンプ＋冪等**（`IF NOT EXISTS` / `DROP POLICY IF EXISTS`）。適用は `"Y" | npx --yes supabase db push`。
- **検証は `npx tsc --noEmit` を基本**。`npm run build` は **push 直前だけ**（重い）。push 後 `xxxx..yyyy master -> master` を確認。
- **コミット署名は作業したエージェント自身の名で**（他AIの名を偽らない）。末尾に各自の `Co-Authored-By` を付ける:
  - Claude Code → `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  - Codex → `Co-Authored-By: Codex <noreply@openai.com>`
- 認証はユーザー版を維持（proxy は cookie があれば getUser 失敗でもログアウトさせない＋SessionKeepAlive）。
- アクセス制御は最終的に **RLS** が担保。UIガードと RLS の両方で守る。
- **同期・一括更新系のロジック変更は、本番初回実行の前に①対象テーブルのスナップショット取得（例: service roleでCSVエクスポート）②dryRunで差分確認、を必ず行う**（2026-07-03のデータ消失インシデントの教訓。本番DBはPITR/バックアップ無しで、消えたら戻せない）。

## ドキュメント索引
- `docs/CLAUDE-HANDOFF.md` … **最新の進捗・引き継ぎ（まずここ）**
- `docs/UX-ISSUES-2026-06.md` … **UX問題台帳＋確定方針**（文脈FAB・ガクつき禁止・スワイプ編集削除・記録ブロック別・ノート再設計 等。根拠つき）
- `docs/UI-UNIFICATION.md` … UI・操作・システムの **統一規約**（書く=全画面 / 選ぶ=シート、**編集削除=スワイプ＋長押し**、ガクつき禁止、共通部品、取得=queries.ts、キャッシュ方針）
- `docs/UI-AUDIT.md` … ガラパゴス棚卸し＋ **FAB再設計案**（残課題と確定方針）
- `docs/SCHEDULE-MENU-PLAN.md` … 予定のブロック対象化＋メニュー刷新
- `docs/NOTES-PLAN.md` … ノート機能
- `docs/SHEETS-IMPORT-PLAN.md` … 予定のスプレッドシート一括入力
- `docs/NOTIFICATIONS-PLAN.md` … 通知機能（通知センター・受信設定・Web Push）※実装・本番投入済み
- `docs/QA-CHECKLIST.md` … 実機QA項目
- `docs/ui-data-guidelines.md` … UI/データの細目

## 実装バックログ（2026-07-03 全体コードレビュー → オーナー確定。ここが現在の実装指示）

> 2026-07-03 の全体レビュー（Claude Code / Fable 5）でオーナーが採否を確定した作業リスト。
> **1タスク＝1コミット**。着手前に対象コードの現状を必ず確認すること。
> マイグレーションは従来どおり新タイムスタンプ＋冪等で作成し `"Y" | npx --yes supabase db push` で本番適用。
>
> **着手順（オーナー確定 2026-07-10 改訂。旧: 2026-07-03版）:**
> `13`（週次CSVバックアップ・**最優先**。本番DBはPITR/バックアップ無しのまま書き込み経路だけ増えており、事故ったら戻せない状態が続いている。タスク2完了直後に実施推奨だったが未着手のまま）
> → `16残のfetchAllRawタイムアウト対策`（65部員で約70秒 vs maxDuration=60。100人想定では毎時同期が黙って死ぬ。**着手前に必ず実測**）＋`14残`（連続失敗アラート・シート名不一致の可視化。「死んだことに気づけない」問題とセットで解消）
> → `7残の週間サマリー中長距離限定`（home/page.tsx の WeeklySummary が今も全部員表示。小修正）
> → `12残`（⋯ボタン統一）→ `9`（@メンション）→ `8`（検索）→ `5残`（P2カーソル化・P5引数削除）→ `10残`（a ワンタップ再取込・c 表形式一括入力）→ `11-b`（まとめて入力）→ `4-S3`（GAS secret のPOST化）→ `6残`（型生成・分割等）→ `7残のSWオフライン対応`。
>
> 完了済み: `0` `1` `2` `3` `6-Q3` `7の未来日ブロック` `10-b` `11-a` `4-S4` `5-P1/P3/P4` `12のコメント500字・propsフェッチ` `16主要部`（各節・作業ログ参照）。
>
> **タスク16（練習記録のスプシDB化）は2026-07-10に主要部分を実装・本番反映済み**（詳細は該当節と作業ログ参照。残作業あり）。（旧タスク15＝感想欄未反映バグは、真因「タブに感想見出しが無い」をオーナーがシート側で解消したため削除済み 2026-07-09）
> ※`4-S5`（暗号鍵分離）は Drive 連携者の再連携が必要なため、単独でオーナーとタイミング調整のうえ最後に（この順序リストにも含めない）。

### 前提となる方針転換（オーナー決定・全タスクに影響）
- **承認ゲート（profiles.approved）は廃止**する。理由: 部外の同大生が入ってくる可能性は実質なく、承認フローが不便。部外生ログイン時の閲覧リスクはオーナー了承済み。
- **スプシ同期は双方向をやめ、部員ごとに方向を固定**する（record_source）。LWW・競合スキップ等の複雑さを撤去する。
- **スプシ由来の記録もタイムラインに表示**する。並び順は**「練習日の0時(JST)に投稿された」扱い**（オーナー確定 2026-07-12。当初の「created_at＝取込時刻のまま」はまとめ取込のたびに先頭で団子になりタイムラインが荒れたため変更。insert時にcreated_at=練習日0時を設定＋既存分はmigration 20260712150000でバックフィル済み）。

### 0. 【バグ・最優先】記録フォーム設定（カスタム項目）が保存されない
症状: マイページ→設定→「記録フォームを編集」で項目を追加・保存しても反映されない（オーナー報告 2026-07-03）。
**切り分け済み（2026-07-03 Claude Fable 5、本番DBで実測）:**
- DB層は正常。使い捨てテストユーザー（検証後削除済み）の authenticated JWT で `PATCH /rest/v1/profiles` の `record_fields` 更新が**成功**する。RLS・列権限・スキーマに問題なし。
- オーナーの本番 `profiles.record_fields` は `[]` のまま＝**クライアント側で更新が送信されていない／無言失敗している**。
- オーナー実機の症状: **保存を押すとモーダルは閉じる（＝safeUpdateが成功扱い＝1行更新が返っている）のにDBは`[]`のまま**。→「空の`fields`で保存が成功している」可能性が最有力。追加操作（addFieldのSheet）で項目がstateに入っていない、またはaddField内で例外が握り潰されている線を最初に疑う。
- 調査手順0: まずVercelの本番デプロイが最新コミットか確認（古いビルド配信の可能性を排除）。次にオーナー実機で「追加→リストに項目が見えるか」を確認してもらう。
- 容疑箇所（この順に潰す）: ①`RecordFieldsSetting.tsx` の save→`safeUpdate` 経路（失敗時 message は出るが気づきにくい）②`FormModalFooter` のポータル登録レース（footerCount→target 設定順で保存ボタンが実際に描画されているか）③`ReorderList`（dnd-kit PointerSensor）が行内の入力・ボタンのタッチイベントを奪っていないか（実機タッチで要確認）④保存ボタンがキーボード表示中に可視か。
- 修正時は実機（iOS PWA）で「項目追加→保存→再度開いて残っている→DBの record_fields に入っている」まで確認すること。

### 1. 承認ゲート廃止
- migration: `profiles.approved` を DEFAULT TRUE 化し、既存の FALSE 行を TRUE にバックフィル。新規ユーザー作成トリガー（handle_new_user 相当）も approved=TRUE で作ることを確認。**approved 列と is_member() は残す**（RLSポリシー群は書き換えない。全員 TRUE になるので実質 authenticated ゲートとして機能し続ける）。
- `src/app/(app)/layout.tsx` の `if (!profile.approved) redirect("/pending")` を撤去。`src/app/pending/` を削除。
- `src/app/(app)/home/page.tsx` の PendingApprovalBanner、`queries.ts` の getPendingProfiles、members 画面の承認UI（set_member_approved 呼び出し）を撤去。RPC 自体はDBに残してよい。

### 2. スプシ同期を「部員ごとの方向固定」へ（最重要）
- migration: `profiles.record_source TEXT NOT NULL DEFAULT 'app' CHECK (record_source IN ('app','sheet'))`。バックフィル: **sheet_name 連携済みの部員は 'sheet'、未連携は 'app'**（従来のスプシ取込を切らさないための初期値。部員には切替方法を周知）。
- `src/lib/sheet-sync.ts` を再構成:
  - record_source='sheet' の部員 → **pull のみ**（シート→アプリ、from_sheet=true）。**空でないシート項目だけ取り込む（非破壊。空欄でアプリの値を消さない）**。シートに行が無い日は触らない。アプリ→シート書き戻しはしない。
  - ⚠️ **2026-07-03 インシデント**: 当初仕様「シートの空欄も反映してよい」（Fable 5起案）で実装した結果、17:00 UTCのcron同期でアプリ側にだけあった6レコードの内容がヌルクリアされた（部員2名、復元不能=PITR/バックアップ無しをCLIで確認済み）。5de45d5で非破壊に修正済み。**非破壊pullが恒久仕様。以後どの方向でも「空で相手の値を消す」実装は禁止。**
  - record_source='app' の部員 → **push のみ**（アプリ→シート）。シート側のマップ済みセルは同期が上書きしてよい（シート＝写し）。シート→アプリ取込はしない。
  - これに伴い LWW（appIsNewer / updated_at・synced_at 比較）、同日複数記録の conflict スキップ、双方向前提の空値保護ロジックを撤去・簡素化。SYNC_CUTOFF・未来日除外・dryRun・sheet_sync_runs ログ・手動同期ボタンは維持。
  - practice_records の読み込みに `.gte("recorded_date", SYNC_CUTOFF)` を付ける（下記 5-P3 と同時解消）。
- UI: ProfileEditForm のシート選択の隣に「記録の入力元: アプリ / スプレッドシート」切替を追加。'sheet' の部員は自分の記録をアプリ内で**編集も新規作成も不可（閲覧のみ）**にし、「入力元をアプリに切り替えると編集できます」と案内（2026-07-03の事故は sheet 部員がアプリから新規作成できたことが一因）。
- **切替時リコンサイル（オーナー確定 2026-07-04・必須）**: record_source を切り替えた瞬間に、その部員だけを対象に一度だけ「両方を揃える同期」を自動実行してから方向を固定する。app→sheet: アプリの中身のある項目をシートへ書き出してから切替。sheet→app: シートの中身のある項目をアプリへ取り込んでから切替。いずれも非破壊（空で相手を消さない）。**両側に中身があり内容が食い違う場合は「切替前まで正だった側」の値で揃える**（app→sheet切替ならアプリが勝ち、sheet→app切替ならスプシが勝ち。2026-07-04 オーナー確認）。同日複数記録など曖昧なケースは触らずスキップして結果に報告。失敗したら切替自体を中止してエラー表示。実装時は必ずdryRunで差分を確認してから本番反映（厳守ルール参照）。
- `/api/sheets/reply`（コメント→シートのリプライ列追記）は追記専用で衝突しないため現状維持。

### 3. スプシ由来記録のタイムライン表示
- `src/lib/queries.ts` getFeed / getUserActivity の `.eq("from_sheet", false)` フィルタを撤去（全ブロック共通）。並び順は created_at のまま。
- from_sheet 列は出典・同期方向の内部管理用に残す。RecordCard に小さな出典表示（「スプシ」バッジ等）を付けてよい（任意）。
- RecordForm で from_sheet:false が短距離側 payload にしか付いていない非一貫は「**insert 時のみ設定・update では変更しない**」に統一。

### 4. セキュリティ残タスク（承認ゲート関連の指摘は上記1により消滅）
- S3: `src/lib/sheet-sync.ts` gasGet のクエリ文字列 secret 送信をやめ、listMembers / fetchAllRaw も POST ボディ化（GAS 側 doPost 対応＋clasp で再デプロイ）。
- S4: `src/app/api/sheets/sync/route.ts:28` の Bearer 比較を `crypto.timingSafeEqual` に。
- S5: `src/lib/google-drive.ts` の暗号鍵を service role key 派生から専用 env `GOOGLE_TOKEN_ENC_KEY` へ分離。**切替時は Drive 連携者全員の再連携が必要**なので、実施はオーナーと本番反映タイミングを合わせること。

### 5. パフォーマンス（全採用）
- P1: `queries.ts` getNotices / getPersonalNotifications / getUserRecords（fromDate なし呼び出し）に limit または期間窓（通知は直近50件＋ページング目安）。**済**（2026-07-04）。
- P2: `TimelineView.tsx` の「もっと見る」を limit 増の全件再取得から**カーソル式**（最後の created_at より古い分を追加取得）へ。**未着手**（2026-07-10確認: 今も `loadMore` が `limit+PAGE` で0件目から再取得する設計のまま。押すたびに読む量が線形に増える。cursorはrecords/tweetsの2クエリをマージしてる関係で両方に必要）。
- P3: sheet-sync の全履歴取得に `.gte("recorded_date", SYNC_CUTOFF)`（タスク2と同時）。**済**。書き戻しの直列 GAS 呼び出しの一括化は未着手。
- P4: `queries.ts` fetchCommentCounts を全行取得→JS集計から count 集計へ。**済**（2026-07-04）。
- P5: getFeed の limit 後フィルタ問題は、タイムラインがクライアント側フィルタなので **getFeed の block/grade 引数を削除**して一本化。**未着手**（2026-07-10確認: 実際の呼び出し元＝home/timeline/TimelineView は全部 `"all"` しか渡しておらず、引数自体が死んでいる。実害は今のところ無いが、将来「サーバー側でlimit後にfilterして件数が減る」を踏み抜く地雷なので削って一本化推奨）。
- P6（2026-07-10追加・メモのみ）: マイページの即時スプシ反映（`refreshMemberFromSheetLive`、タスク16残作業の実装）が 'sheet' メインの部員のマイページ表示に毎回 GAS 呼び出し（最大5秒タイムアウト）を挟む。他のP項目と違い「DBクエリの効率化」ではなく「外部通信を都度挟む設計そのもの」なので対応方針の判断が要る（例: 短時間キャッシュ、非同期化してSuspenseで後追い表示、等）。**実装せずメモのみ。次のエージェントの判断に委ねる**。

### 6. コード品質（全採用。修正によるデメリットなしと判断済み）
- Q1: `npx supabase gen types typescript` の生成型へ移行し `as unknown as`（21箇所）を解消。
- Q2: from_sheet の扱い統一はタスク3に含めて解消。
- Q3: 「今日」の実装を JST 基準の共通 util（jstToday 等）1個に集約。`queries.ts:240,441` の `new Date().toISOString().slice(0,10)`（UTC）は**実バグ**（JST 0〜9時に前日の予定が今後の予定に残る）なので優先的に。
- Q4: MenuForm.tsx（958行）/ ScheduleSheetsManager.tsx（1015行）の分割（対象者ピッカー・プリセット・プレビュー表などの単位で）。
- Q5: getFeed / getUserActivity の FeedItem 組み立て重複（各約40行）を共通ヘルパーへ。

### 7. UI/UX（採用分）
- 記録フォームの日付に未来日を入力できないようにする（max 属性＋バリデーション。保存後に「消えた」ように見える問題の解消）。**済**（2026-07-04）。
- JST統一は 6-Q3 で解消。**済**。
- ホームの週間サマリー（走行距離・練習回数カード）は**中長距離ブロックの部員のみ表示**。他ブロックには表示しない（週間ランキングも従来どおり中長距離のみ）。**未着手**（2026-07-10 コード確認: `home/page.tsx` の WeeklySummary は今も全部員に表示。profile.blocks を見て middle_long を含む部員だけ描画する小修正）。
- Service Worker にオフラインフォールバック＋静的アセットキャッシュを追加（現状 push 専用で、オフラインだと開けない）。**未着手**（2026-07-10確認: public/sw.js にキャッシュ処理なし）。優先度は低め（着手順の最後尾）。

### 8. ノート・お知らせの検索
- ノート（フォルダ・記事）とお知らせを対象にしたテキスト検索を追加。Postgres の ilike で十分（全文検索基盤は不要）。UI はノートタブ・お知らせ画面それぞれに検索欄。

### 9. お知らせの通知先を @メンション式に刷新
- 現在の「全員/複数ロール」選択UIをやめ、`@ロール名` `@部員名` のメンション式へ（@入力でロール・部員のサジェスト表示）。
- メンション対象: ロール→所属部員全員、個人→その部員。重複しても通知は1人1通（20260629120000 の重複排除ロジックを流用）。
- notices にメンション保存列（例: mentioned_role_ids uuid[], mentioned_user_ids uuid[]）を追加し、通知トリガー/関数をメンション基準に改修。本文中のメンションはハイライト表示。
- 全員通知は **`@All`**（オーナー確定 2026-07-03）。サジェストの最上位に「@All（全員）」を出し、従来の notify_members トグルは廃止。メンションが1つも無いお知らせは通知を送らない（掲示のみ）。

### 10. 予定の一括運用を楽にする（2026-07-03 オーナー確定。運用は当面スプシメイン）
**実際の雛形スプシの構造（2026-07-03 オーナー提供の実物をCSVエクスポートで確認済み。URLは公開リポのためここに書かない。オーナーが schedule_sheets 登録時に指定する）:**
- 冒頭数行は自由メモ（練習理論の解説等）。ヘッダー行はその下（「曜日・時間・場所」を含む行を探して特定する。日付列のヘッダーは固定名でない）。
- 列: `日付 | 曜日 | 時間 | 場所 | メニュー | ペース | 補足 | 補強`。**予定（時間・場所）とメニュー（メニュー/ペース/補足/補強）が同居**している。
- 日付は `6/1` 形式で**年なし**。タブ＝月単位で、月末に翌月初日がはみ出すことがある（例: 6月タブに 7/1）。対象月から年を補完し、月跨ぎも正しく解釈する。
- **全日付の行が最初から存在する**（行がある＝練習日ではない）。時間・場所・メニューのいずれかに中身がある行だけを予定として取り込む（**オーナー確認済み 2026-07-03**。補強列だけの日は予定にせずメニュー情報としてのみ扱う）。
- 取込は予定(practice_schedules)だけでなく、メニュー列から**ブロック全体メニュー(practice_menus)も同時に生成/更新**する（メニュー/ペース/補足/補強を本文に整形）。
- この雛形は**中長距離用**（オーナー確認済み）。短距離のスプシは非公開のため、当面はこの形式のみ対応し、シート登録時にブロックを指定する設計にしておく。
- 現行の `schedule-import.ts` はヘッダー名完全一致・全行=予定前提のため、この実物形式に合わせたパーサの改修が a)〜c) すべての前提になる。
- a) **スプシ登録は初回1回だけ・以後ワンタップ再取込**: schedule_sheets に登録済みのシートを予定画面から選んで「取込」一発で差分反映できる導線に（毎回のURL発行・貼り直しを廃止）。既存の preview/検証/RPC 経路を再利用。
- b) **定期自動取込**: pg_cron で登録済み予定シートを毎日チェックし差分を自動反映。**非破壊**（追加・更新のみ。削除はアプリからのみ）＋取込結果（件数・エラー行）を管理者に通知。記録同期の Bearer 認可・runsログの仕組みを踏襲。
- c) **アプリ内「表形式で一括入力」**: 取込プレビューの編集表（EditablePreviewTable）を流用し、シート無しでも同じ表を空から編集して一括登録できるモードを追加。月を選ぶと日付・曜日行を自動生成し、曜日デフォルト（weekdayDefaults: 月水17:00・土9:00＋場所）をプレフィル。検証・登録は既存インポート経路をそのまま通す。将来のアプリ一本化への布石。

### 11. メニュー作成の手間削減（2026-07-03 オーナー確定）
- a) **プリセット機能を「過去メニューから複製」に置き換え**: 作成画面に履歴ピッカー（自分が過去に公開したメニューを新しい順に表示・検索）を置き、選ぶと本文・対象ブロック・対象者が入る。手動の「プリセット保存・名前付け・上書き」操作を廃止（localStorage プリセットのコードも撤去）。直近値の自動初期値（対象者引き継ぎ）は維持。
- b) **まとめて入力**: 予定のある日（今週/今月）を複数選択 → 日ごとに本文を編集できる縦リストで一括保存。対象ブロック・対象者は共通指定。a) の複製と組み合わせ「先週分をコピーして今週3日分に貼る」を数タップにする。

### 12. 細かいUI改善（2026-07-03 オーナー確定）
- 編集・削除の導線を **⋯ボタンに統一**し、スワイプ＋長押しは廃止（`docs/UI-UNIFICATION.md` の「編集削除=スワイプ＋長押し」規約は**失効**。矛盾があれば本節が正）。
- コメントの最大文字数を 200 → **500** 字に（入力欄・DB制約があれば両方）。
- RecordForm のカスタム項目を開くたびの DB フェッチ（RecordForm.tsx:69-80）をやめ、取得済みプロフィールから props で渡す。

### 13. 週次CSVバックアップ（2026-07-04 オーナー確定。**現在の最優先タスク＝キュー最前列** 2026-07-10 オーナー確定）
- 週1回、主要テーブル（practice_records / profiles / notes / note_articles / notices / practice_schedules / practice_menus）を自動でエクスポートして保管する。
- 実装はシンプル優先の例: Bearer認証の `/api/backup` を新設（service roleで全件をCSV/JSON化）→ GASの時限トリガーから週1で叩いてオーナーのDriveへ保存（sync-api の Bearer/clasp 構成を踏襲）。直近8世代を保持し古いものは削除。
- 背景: 本番Supabase（Free）はPITR・バックアップ無し。2026-07-03の消失事故では戻す手段が無かった。当初「タスク2の直後に実施推奨」だったが未着手のまま経過し、その間にwrite-through等で書き込み経路だけ増えている。**他の全タスクの事故保険になるため最優先**（2026-07-10 オーナー確定）。

### 14. 同期の運用堅牢化（2026-07-04 オーナー確定。タスク2と同時に実施）
背景: 2026-07-02 13:00〜07-03 16:00の**28時間、毎時の同期が「シート『B3 山端』が見つかりません」で全滅していたのに誰も気づけなかった**（sheet_sync_runsに記録は残っていたが通知が無い）。1人のシート不調で全員分の同期が止まる作りだったことが、事故の遠因（失敗が安全弁を兼ねていた→タブ復旧と同時にバグ入りpullが発火）。
- **部分失敗設計**: 部員ごとに try/catch し、1人の失敗（タブ改名・削除等）で他の部員の同期を止めない。失敗した部員と理由を sheet_sync_runs に記録。**済**（2026-07-04）。
- **連続失敗アラート**: 同期が連続N回（目安3回）失敗したら、**システム管理ロール（can_manage_system 保持者）**へアプリ内通知＋Web Push（既存の通知基盤を流用。通知先は管理者=can_manage_members ではない。オーナー指定 2026-07-04）。**未着手**（着手順でタスク16残のタイムアウト対策とセットで実施 2026-07-10）。
- **"running"放置の解消**: タイムアウト等でrunが"running"のまま残る問題（07-02 20:00 / 07-03 14:00 に実例）。finallyで必ず終了状態を書く＋次回実行時に一定時間過ぎたstale runをerrorへ倒す。**済**（2026-07-04）。
- **シート名不一致の可視化**: GASのタブ一覧と profiles.sheet_name の突合結果（不一致者）を管理者の同期画面に表示（タブ改名の早期検出）。**未着手**（連続失敗アラートと同時に実施）。
- **pg_cronのジョブ名は用途ごとに固有名を厳守**（記録同期=`sheet-sync-hourly`、予定取込=`schedule-import-hourly`）。`cron.schedule` は同名で黙って置き換えるため、名前を共用すると既存ジョブが消える（2026-07-04に記録同期cronが約20時間消失した実例）。cron登録SQLをオーナーに案内する際は、必ず `select jobname from cron.job` での事前確認手順を添える。

### 15.（削除済み 2026-07-09）感想欄がスプシに反映されないバグ
真因は「部員タブに『感想』『コメント』見出しの列が無いと、名前ベースのマッピングが黙ってスキップする」こと（実物CSVで確認。タブごとに列構成が異なり、感想列が無いタブが実在した）。**オーナーがシート側に見出しを追加して解消済みのためタスクとしては削除。** 教訓として「未マップ項目の可視化（黙って落とさない）」はタスク16の一項目に引き継ぐ。位置固定フォールバック（旧TFの17列目方式）はタブによって別の列を汚すため採用しない。

### 16. 練習記録の「スプシDB化」（'sheet'部員＝旧TFアプリ方式。オーナー確定 2026-07-09）
方針: 練習記録に限り、部員ごとに**メインDBを選べる**ようにする（個人設定「記録のメイン: アプリ / スプレッドシート」＝record_source の意味を再定義）。**スプシメインの部員は旧TFアプリ（D:\AI\Antigravity\TF）と同じ仕組み**＝スプシが唯一の正で、アプリは「スプシを読み書きする端末」。アプリメインの部員は従来どおりSupabaseが正で毎時push。**いいね・コメント・投稿時刻・通知は全部員Supabaseメイン（オーナー確定）**。想定部員数は**100人**。「一旦広めるため」＝スプシで生活している部員が行動を変えずにアプリのソーシャル機能を使えるようにするのが目的。

**2026-07-10 実装・本番反映済み（Claude Code Sonnet 5）:**
- **write-through（保存→即スプシ反映）を実装**。RecordForm の 'sheet' ブロック（タスク2で追加した閲覧専用表示）を撤去し、通常の編集フォームに統一。保存後、`/api/sheets/push-record`（本人のみ・ユーザーセッション認可）が非破壊push（`appToCellsNonEmpty` 流用）でGAS `writeCells` を呼ぶ。GAS書き込みが失敗してもDB保存自体は失われない（Supabaseへの保存が先行し、既に成功済み）が、成功したとは見せずtoastで警告し、`practice_records.pending_sheet_push`（新設・migration 20260710100000）をtrueにして次回毎時同期での再送対象にする。
- **GAS拡張**: `fetchMember`アクション追加（1部員だけ軽量取得。個人の記録画面・write-through確認用。100人規模でも毎回fetchAllRawを引かずに済む）。`writeCells`が書けなかった見出し(`unmapped`)を返すよう変更（未マップ項目の可視化。旧タスク15の教訓を反映）。clasp pushで本番反映済み（deployment `AKfycbyXUDkqE9BdgdNJmb9sGSZK6CTKt_J7OTyLuLvKXwZC3tPexS-i_XkndjuluQ33D7UK @6`）。
- **記録カード（RecordCard/PostOwnerMenu）の編集可否**: 記録のメインが'sheet'の部員は、from_sheet=trueの過去記録（過去のpull由来）も含めて自分の記録を編集可能にした（従来は from_sheet=true を一律「編集不可・閲覧のみ」にしていた）。`AuthorMini`に`record_source`（optional）を追加し`queries.ts`のAUTHOR_SELECTで取得。
- **⚠️ dry-runで実際に問題を発見・修正済み**: 当初、毎時同期側の「write-through失敗時の再送」を既存の`appIsNewer`（updated_at>synced_at比較）で判定する設計にしたところ、本番dry-runで**write-through導入前からの無関係なタイムスタンプのズレ**（'sheet'部員6名・8件、原因不明の過去データ）を「再送対象」に誤検知し、部員がスプシへ直接入力した内容を古いアプリ値で上書きしかねないことが判明。専用フラグ`pending_sheet_push`（write-through失敗時のみtrue、成功でfalseに戻す）に設計変更し、再dry-runで`pushed:0`（誤検知解消）を確認してから本番migration適用・push。**厳守ルールのdry-run確認がまさにこの事故を防いだ実例**。
- **Supabaseミラー（内部配管）**: 既存のpull-onlyロジック（非破壊）をそのまま維持。'sheet'部員の記録もこれまでどおり毎時cronで取り込まれ、いいね・コメント・タイムライン・週間集計のキーとして機能する。
- **個人の記録画面の即時反映（2026-07-10実装）**: マイページ・自分の`/members/[id]`表示時に`refreshOwnSheetRecords`（`queries.ts`）→`refreshMemberFromSheetLive`（`sheet-sync.ts`）が`fetchMember`で本人1人分だけ軽量取得し、毎時cronを待たずその場でDBミラーへ非破壊pullしてから記録を読む。cronのpull-onlyロジックは`computeMemberPull`として共通化（cron本体の挙動は不変・純粋な抽出）。GAS呼び出しは5秒タイムアウトで失敗しても例外を投げず、DBの現状のまま表示する（ページを壊さない）。他人の記録閲覧時（isSelf=false）は呼ばない（RLSで書けないうえ無駄なGAS呼び出しになるため）。
- **1日1記録の制約**: 既存のRecordForm「同じ日の記録があれば新規ではなく更新」ロジック（重複防止）がそのまま適用されるため追加実装不要だった。

**残作業（次のエージェントが着手する場合はここから）:**
- 100人規模でのfetchAllRaw応答時間を実測したところ**65部員で約70秒**（2026-07-10実測）。既存の`/api/sheets/sync`ルートは`maxDuration=60`のため、**部員数がこれ以上増えるとhourly cronがタイムアウトする可能性が高い**（今回のタスク16実装より前からの既存リスク）。対応候補: ①maxDurationを引き上げる（Vercelプランの上限を確認）②fetchAllRawをfetchMemberの並列呼び出しに置き換える③タブ分割バッチ化。**次のエージェントは着手前に実測すること**。
- 未マップ項目(`unmapped`)をtoastで警告表示するようにしたが、記録フォーム側にも恒常的な表示（例:「この項目はスプシに列が無いため保存されません」の事前案内）はまだ無い。
- 実機（iOS PWA）での動作確認は未実施。特に: ①'sheet'部員が記録を新規作成→保存直後にスプシに反映されるか ②GAS書き込みをわざと失敗させて`pending_sheet_push`が正しく再送されるか ③from_sheet=trueの記録がRecordCardから編集できるようになっているか。

### 不採用（実装しないこと。過去の提案を根拠に着手しない）
- メニュープリセットのDB保存化（プリセット機能自体を 11-a で置き換えるため不要）。
- 承認待ち画面の改善（リアルタイム承認検知）… 承認ゲートごと廃止のため不要。
- ダークモード。
- 記録・つぶやきのオフライン下書き保存。
- コメントの @メンション（お知らせのみ対応する）。
- 出欠リマインド通知・カレンダー(ICS)連携・PB自動判定 … 今回は見送り（禁止ではなく未承認）。

## 衝突防止：固定の担当領域は設けない（柔軟運用）＋必ず報告する
どのAIも領域を限定しない（柔軟に動けるように）。代わりに**「何を触るか／何をしたか」を必ず下の作業ログに報告**して可視化で事故を防ぐ。
- **作業は1体ずつ。`git pull`→作業→検証→push まで終えてから次のエージェントに渡す**（push 前の中途半端な状態で別の体に着手させない）。
- 着手したら**着手前に必ず `git pull`**（受け渡し直後でも省略しない）。
- **着手前**：下の「作業ログ」に1行追加（日付・エージェント名・これから触る範囲）。
- **完了後**：同じ行に結果（commit ハッシュ・要点）を追記。大きな変更は `docs/CLAUDE-HANDOFF.md` に詳細を書く。
- 他AIが直前に触った範囲は、ログを見て**現状コードを確認してから**触る（古い前提で上書きしない）。

## 作業ログ（着手前に追記・新しいものを上へ）
<!-- 形式: YYYY-MM-DD / エージェント / 触る範囲 → 結果(commit・要点) -->
- 2026-07-12 / Claude Code (Fable 5) / オーナー報告2点を修正。**①FreezeProbeのトースト廃止**（タイムライン→ノート遷移時に「フリーズ痕跡」トーストがたまに出る報告。実態はiOSがメモリ回収でPWAページを静かに再読込したケースも異常終了として拾うため。フリーズ本体は解決済みなので、以後はlocalStorage（tuat-freeze-reports）とconsole.warnの記録のみ＝調査が必要になったら参照）。**②ノートの共有/個人タブを保持**: 選択をcookie（tuat-notes-scope）に保存し notes/page.tsx がSSRで復元（タイムライン簡易表示cookieと同じ方式・ハイドレーションフラッシュ無し）。ノート詳細から戻っても個人タブのまま。tsc/build成功・**実機確認は未実施** → (このcommit)
- 2026-07-12 / Claude Code (Fable 5) / Codex引き継ぎのオーナー依頼キュー②③を実装（末尾の「Claude handoff — 2026-07-12」節参照）。**②ホーム今後の予定カードの出欠数即時反映**: `UpcomingScheduleCard.tsx`新設（クライアント側で出席/欠席数を差分更新。AttendanceToggleの失敗時onChanged再発火でロールバックも成立）→ dd848ff。**③スプラッシュ終了をシーン間と同じ白フラッシュ明転に**: flash-exit-in(3.98s→4.28s白ピーク)→ピークでステージ非表示・白の下からホーム→白450msフェードアウト。ヘッドレスWebKitのコマ撮りで確認済み → bf64ab4。**残: キュー①（記録・つぶやきの楽観更新＝router.refresh待ちをやめる大掛かりな変更）は未着手**。HomeFeed/TimelineViewの整合まで含む設計判断が要るため、次のエージェントはまず両コンポーネントの現行キャッシュ構造を読んでから着手すること。tsc/build成功・**実機確認は未実施（②の人数増減・③の明転はオーナー実機で要確認）** → (このcommit)
- 2026-07-12 / Claude Code (Fable 5) / ホーム遷移フリーズの根本原因切り分け: **`next.config.ts`の`cacheComponents: true`を無効化**。根拠は重大インシデント節に追記（有効化=07-12 00:14と症状開始の一致、Tab LabのRouter外安定、他容疑の全撤去でも再現、依存コード無し）。タブ切替速度は東京リージョン＋react-queryセッションキャッシュ＋loading.tsxで担保。tsc/build成功・WebKit E2E全パス（他タブ→ホーム遷移含む）。**実機判定待ち＝これで直ったらcacheComponentsは再導入禁止リスト入り、直らなければ「Router層でもない」ことが確定するので次はNext.jsのバージョン更新(16.2.9→最新patch)を試す** → (このcommit)
- 2026-07-12 / Codex / Tab Lab実機結果: A=61回 平均10ms/最悪23ms/停止6ms、B=59回 24/29/9ms、C=61回 24/75/26msで全モード安定。ただしCの遷移元は空画面で、実予定DOM破棄→実ホーム構築は未検証とのオーナー指摘。D=実予定⇔実ホームをRouter/Activityなしで破棄・再表示するモードと、切替後DOMノード数・最大DOM数の計測を追加。tsc/対象lint/build成功、実機判定待ち → (this commit)
- 2026-07-12 / Codex / iOSタブ基盤の再構築案を推測で本番採用せず検証するため、通常画面から隔離したClient Tab Labを実装。A=空画面、B=36枚の軽量DOM、C=現ホームをRouter/Activityなしで破棄・再表示。タップ→2描画時間、最大イベントループ停止、直前50操作をlocalStorageへ保存し結果コピー可能。システム管理者だけマイページ→その他に導線表示。通常5タブ・DB・同期処理は変更なし。tsc/対象lint成功（home既存unused警告2件のみ）、本番build成功。実機A→B→C判定待ち → (this commit)
- 2026-07-12 / Codex / iOSフリーズ調査の実機結果を反映。`c5786a9`(IDB停止)、`e2f2497`(予定Route Handler化・重複prefetch撤去・PullToRefresh停止・スケルトン修正)、`26ad026`(passive方式でPullToRefresh再導入)→`18c948f`(即撤回)を本番投入したが、最終実機結果は**別タブからホームへ毎回遷移不能・フリーズ**。PullToRefreshは明確な悪化要因だが撤去後も再現し、根本原因未特定。今回の対策群を成功扱いしない。AGENTS.mdに重大未解決インシデントとして記録 → (このcommit)
- 2026-07-12 / Claude Code (Fable 5) / FreezeProbeの初回実機データ入手: **フリーズは /schedule と /timeline に集中**（オーナー報告）。＋リロード時の「一瞬上にズレてガクッと戻る」報告。ローカル再現不可のためCodexへ引き継ぎ（**詳細は docs/CLAUDE-HANDOFF.md 冒頭の2026-07-12節が正**。最有力仮説: この2画面だけにあるreact-queryキャッシュ機構＝timelineのIndexedDB永続化／scheduleのServer Action queryFn）。コードはドキュメントのみ変更 → (このcommit)
- 2026-07-12 / Claude Code (Fable 5) / オーナー提案を実装: **スプシ由来記録のタイムライン並び順を「練習日の0時(JST)投稿扱い」へ変更**（取込時刻のままだと、まとめ取込のたびに数日分が先頭で団子になり順番が荒れるため）。`sheet-sync.ts` computeMemberPullのinsertに `created_at: 練習日T00:00:00+09:00` を追加＋migration 20260712150000で既存のfrom_sheet=true全80行をバックフィル（冪等UPDATE）。厳守ルールどおり適用前にスナップショット取得（scratchpadのsnapshot_from_sheet_created_at_20260712.json、80行のid/created_at）→オーナー承認→db push→RESTで全80行が0時JSTになったこと検証済み。タスク3の「created_at＝取込時刻」方針は本節で上書き（方針転換の節も更新済み）。tsc OK → (このcommit)
- 2026-07-12 / Claude Code (Fable 5) / オーナー報告続報3点（①予定タブ表示時に一瞬UIズレ ②ホームのリロード=スピナー回りっぱなし ③予定→他タブ→予定で完全フリーズ・要アプリ再起動）。**E2E再現テストを実施**（オーナー許可を得て使い捨てテストユーザー作成→検証→削除。scripts/repro-freeze*.mjs 新設、playwrightは`npm i --no-save`）: ローカル本番ビルド＋Chromium/WebKit＋タッチ合成のpull-to-refreshで**いずれも再現せず**＝実機iOS PWA固有。②③は「メインスレッド停止」で説明が付く（スピナーはCSSアニメでGPU駆動のため固まっても回り続ける。スクロール不能はPullToRefreshの非passiveリスナー経由）。対応3点: (1)**FreezeProbe新設**（(app)layout常駐。1秒心拍をlocalStorageへ、hidden/pagehideで正常離脱マーク。次回起動時に異常終了を検出しconsole+直近5件保存、can_manage_system保持者にはトーストで場所を通知→**実機の証拠が取れる**）(2)**experimental.staleTimesを撤去**（cacheComponentsと併用の"use with caution"実験。導入以降に症状が出始めた最有力容疑。タブ速度は東京リージョン＋各画面のreact-queryキャッシュで担保）(3)**PullToRefreshの非passiveなtouchmoveを常時登録→タッチ中のみ動的登録に変更**（全スクロールが毎フレームJSを通っていた＝iOSカクつきの一因除去）。tsc/build成功、新ビルドでWebKit E2E全パス（pull表示→900ms消灯・タブ5往復・フリーズ無し）。**次: オーナーの実機でフリーズ再発時、次回起動時のトースト（フリーズ痕跡+パス）を報告してもらう** → (このcommit)
- 2026-07-12 / Claude Code (Fable 5) / オーナー再々報告「リロードが終わらない・タブ切替が今ももっさり（YouTube等はサクサクなのに）」→ 計測で**物理的な根本原因を特定**: 本番の `X-Vercel-Id` が `hnd1::iad1::` ＝ **サーバー関数が米国東海岸(iad1)で実行**されていた（Vercelのデフォルト。リージョン未指定だった）。DBは東京Supabase（日本から実測45〜75ms）なので、**全DBクエリがバージニア⇔東京を往復（~150-180ms/回）**。ホームはプロフィール＋5セクションで多数往復するため1画面数秒、`router.refresh()`も数秒→「終わらない」体感、キャッシュ切れタブへの遷移も同様に「もっさり」。実測: `/apple-icon`(dynamic) TTFB 1.6s、401即返しのAPIですら345ms。修正: `vercel.json` 新規作成で `"regions": ["hnd1"]`（関数を東京へ固定）。これで1往復~2-10msになり全画面のサーバー時間が桁で縮む見込み。**デプロイ後の実測で確認済み（d365017）**: `X-Vercel-Id: hnd1::hnd1::`、`/apple-icon` TTFB 1.63s→0.16-0.35s、401即返しAPI 345ms→~150ms。DBクエリを多数打つログイン後ページはさらに大きく縮むはず。**実機での体感確認はオーナーに依頼中**。あわせて同時刻、823b6ceの同期修正が本番cronで効いたことも確認: 05:00 UTCのrunで pulled_count:10（3日分の滞留解消）・failed_members空 → d365017
- 2026-07-12 / Claude Code (Sonnet 5) / オーナー再報告「ホームでのリロードが終わらない」＝直前の自分のcommit(56ff64c)が原因の回帰と判明。`PullToRefresh.tsx`のインジケーターを`useTransition`のisPending連動に変えたが、これはまさに46e79a7（"Prevent refresh indicator...from hanging"）で**一度直したのと同じ不具合**（ホームは5つのSuspense境界に分かれたasync Server Componentなので、isPendingが解消されずスピナーが回りっぱなしで固まるケースがある）を再発させていた。useTransitionを撤去し46e79a7と同じ固定900msタイマー方式に戻す（router.refresh()の完了を示すコールバックはNext.jsに無いため、完了連動は諦め安全な固定時間に統一）。tsc/build成功。**実機確認は未実施** → cb0278a
- 2026-07-12 / Claude Code (Fable 5) / オーナー報告「リロードが終わらない・タブ切替がカクつく/遅い・演出中に5タブ読み込んでるはずでは」を調査・修正。**判明した事実**: BottomNavの`Link prefetch={true}`は動的ルートもデータ込みで完全プリフェッチする（スプラッシュ中に5タブ先読み自体は機能していた）が、`staleTimes.dynamic: 30`のため**30秒で失効**し、以降のタップは毎回サーバー往復待ちだった。修正: ①`next.config.ts`のdynamicを300秒へ延長（タイムラインIndexedDBの5分TTLと整合。鮮度は引っ張って更新と各画面のセッションキャッシュで担保）②`PullToRefresh.tsx`のインジケーターを固定900msの見せかけから`useTransition`の実完了連動＋保険6秒キャップ＋最低表示500msに変更（「回ってるのに内容が変わらない/いつ終わったか分からない」の解消。以前useTransition単独で固まった経緯があるためキャップ必須）。tsc/build成功。**実機確認は未実施** → (このcommit)
- 2026-07-12 / Claude Code (Fable 5) / 【インシデント対応】毎時の記録同期が**2026-07-09 12:00 JSTから3日間・73回連続で新規取込ゼロ**だったことをsheet_sync_runsで発見（オーナーの「様々なエラー」調査中）。原因: 部員のシートの「流し」列に小数`0.3`が入っており、`practice_records.strides`がINT型のため一括insertが丸ごと失敗（`invalid input syntax for type integer: "0.3"`）。runのstatusは"success"のままだったため誰も気づけず（タスク14の連続失敗アラート未実装も遠因）。修正(`sheet-sync.ts`): ①stridesは`Math.round`で整数化して取り込む②一括insert失敗時は1件ずつ入れ直し、不正な行だけ部員名・日付つきでfailed_membersに記録して残りを取り込む（型不一致の道連れ全滅を構造的に防止）。`scripts/dryrun-sync.ts`新設（`npx tsx --env-file=.env.local scripts/dryrun-sync.ts`）で本番dryRun実施: inserted:10（3日分の滞留が復活）・failed:0を確認してからpush。**本番反映後に手動同期で実際に10件入るかの確認が必要** → (このcommit)
- 2026-07-12 / Claude Code (Sonnet 5) / スプラッシュ第3弾: プリロード改善後も実機iPhoneでカクつき・ワイプが「読み込みラグ」に見える問題が解消せず、**CSSアニメを廃止して事前レンダリング動画方式に全面変更**（オーナー指示「なんとかして」）。あわせてオーナー指示でシーン2→3の横ワイプをフェードに変更（プロトタイプ側で修正後キャプチャ）。手順: プロトタイプをヘッドレスEdge(390x844@2x)で25fps・85フレームキャプチャ→ffmpegで`/splash/intro.mp4`(780x1688, H.264 crf24, 5.0s=演出3.4s+余韻1.6s clone、約1.8MB)にエンコード。`SplashIntro.tsx`を`<video muted playsInline preload=auto>`再生に書き換え（canplaythrough待ち・保険8秒/25秒、未ログイン時は`playbackRate=2/3`で5.1s相当、sessionStorage 1回制・reduced-motionスキップ・タブprefetch分散は維持）。不要になったWebP6枚+ArchivoBlack.woff2と`<link rel=preload>`群・Shadow DOM・SVGフィルタ複製を削除。tsc/build成功・dev再生確認。**iOS実機での再確認はオーナーに依頼中** → (このcommit)
- 2026-07-12 / Claude Code (Sonnet 5) / スプラッシュ実機フィードバック第2弾（画像が間に合わず背景なし・最終カードが右から流れ込む）。原因: 実機回線ではプリロード上限3秒が先に切れて画像が揃わないまま再生開始していた。修正: ①`<link rel="preload">`（画像6枚＋フォント）を初期HTMLに追加しeffect実行前からDL開始②画像を1280w→1024w/q68へ再圧縮（計約1MB→約523KB）③待機を「揃うまで待つ（保険8秒）」に変更。tsc/build成功・devで再生確認 → (このcommit)
- 2026-07-12 / Claude Code (Sonnet 5) / スプラッシュのiOS実機フィードバック対応（文字が細い・序盤ガクつき・最終カードで一瞬白・ステータスバーが白いまま）。原因と修正: ①iOSに'Arial Black'が無くフォールバックの細字になっていた＋画像未ロードのまま再生開始→**画像6枚とフォントをプリロード（上限3秒）してから再生開始**、フォントは`document.fonts.load()`で明示ロード（当初`FontFace.load()`のreject未処理で演出自体が死ぬバグを混入させ、ヘッドレス検証で発見して修正）②SafariはShadow DOM内の`filter:url(#id)`をdocument側で解決するため質感フィルタが無効→**フィルタ定義SVGをlight DOMにも複製**③タブprefetchを開始0.8秒後から150ms間隔に分散（開始直後のジャンク軽減）④`statusBarStyle`を`default`→`black-translucent`に変更（ヘッダー類は既にsafe-area-inset-top対応済み）。tsc/build成功、devサーバーで再生→フェードアウト→ログイン画面表示まで確認。**iOS実機での再確認はオーナーに依頼中** → (このcommit)
- 2026-07-12 / Claude Code (Sonnet 5) / 起動スプラッシュ演出の新規実装（オーナー依頼。MV風タイトルアニメ「TUAT / Track / Field」約3.4秒＋余韻）。`src/components/SplashIntro.tsx` 新規（アプリCSSと衝突しないよう **Shadow DOM に注入**。1セッション1回のみ＝sessionStorage、`prefers-reduced-motion` はスキップ、**未ログイン時（sb auth cookie無し）は5.1秒のゆっくり再生**＝オーナー指定）・`src/app/layout.tsx` の body 末尾にマウント・`public/splash/` に WebP画像6枚(計約1MB)とArchivo Blackフォント追加。再生中に `router.prefetch` で全タブ（home/schedule/timeline/members/notes/notices/ranking/venues/mypage）を先読み。既存機能のロジック変更なし。tsc/build成功、devサーバー＋ヘッドレスEdgeで縦画面の各フェーズ描画を確認済み（途中、absolute+left:50%でタイトルが2行に折返す問題を white-space:nowrap で修正）。**実機(iOS PWA)確認は未実施** → (このcommit)
- 2026-07-11 / Claude Code (Sonnet 5) / オーナー再報告（Codexが再改修した遅刻UIが「浮いてる」・遅刻の送信成否が分からない）を受け`AttendanceToggle.tsx`/`ScheduleCard.tsx`を再修正。**「浮いてる」原因**: `LateAttendanceControl`が設定画面用の`Toggle`（フルwidth・カード枠・説明文付きの大きい行）と`Input`（h-11フルwidth）をそのまま流用し、出欠行の下に別ブロックとして挿入されていたため、コンパクトなピル型UI（出欠ボタン・出席者数チップ）の中で見た目が浮いていた。専用の小型チップ（他のピルと同じh-8・rounded-full）に作り直し、出欠ボタン・出席者数チップと**同じ行に並べる**よう`ScheduleCard`側のレイアウトも変更（別行の`space-y-2`ブロックを廃止）。**送信成否が不明な問題**: 出欠タップ・遅刻トグルはSupabaseのerrorを握りつぶしており失敗しても何も表示されなかったため、両方に`error`チェック＋失敗時はローカル表示を元に戻しつつ`useToast`でエラー表示するよう追加。遅刻メモ（デバウンス保存）は特に無言だったため、入力欄の右に保存中(スピナー)/送信済み(チェックマーク・1.8秒で消える)/エラー(赤枠)を表示する`noteState`インジケータを追加。tsc/lint/build成功。**実機確認は未実施** → (このcommit)
- 2026-07-11 / Claude Code (Sonnet 5) / オーナー報告（Codex実装の遅刻機能: UIが良くない・やたらロードが入る）を受け`AttendanceToggle`/`ScheduleCard`を修正。**根本原因**: `AttendanceToggle`が`refreshOnChange`経由で出欠タップ・遅刻トグル・遅刻メモ入力欄のblurの**都度`router.refresh()`**（ページ全体のサーバーコンポーネント再取得）を呼んでおり、1操作で最大3回の全体リロードが発生していた。`onChanged`コールバックを`{status, isLate, lateNote}`を返す形に拡張し、`ScheduleCard`側でその部員の出欠だけをローカルstate（`attendeesState`）で即時反映する設計に変更（`myProfile`propを新規追加し出欠一覧の表示名等に使用）。`router.refresh()`呼び出しをこの機能から全廃。あわせてUI: 出席時に遅刻トグルが出ると出欠ボタン自体の幅が116px→flex-1に急拡大していた挙動（レイアウトが跳ねる）を廃止し、ボタン幅を常時104px固定・遅刻トグルは横に固定幅で追加される形に変更。呼び出し元(`ScheduleView.tsx`/`schedule/page.tsx`/`home/page.tsx`)に`myProfile`受け渡しを追加。tsc/lint/build成功。**実機確認は未実施** → (このcommit)
- 2026-07-10 / Claude Code (Sonnet 5) / オーナー確定を受け着手順を2026-07-10版に改訂（コード変更なし）。新順序: **13（週次CSVバックアップ）を最優先**→16残のfetchAllRawタイムアウト対策＋14残（連続失敗アラート・不一致可視化）→7残の週間サマリー中長距離限定→12残（⋯統一）→9→8→5残（P2/P5）→10残（a/c）→11-b→4-S3→6残→7残のSW対応。完了済み項目をタスク5/7/13/14の各節に**済/未着手**として明記（7の週間サマリー全部員表示・sw.jsキャッシュ無しは2026-07-10にコード確認済み）。4-S5は従来どおりオーナーとタイミング調整のうえ最後 → (このcommit)
- 2026-07-10 / Claude Code (Sonnet 5) / オーナーの依頼で「表示の効率化」を調査しタスク5節にメモを追記（**コード変更なし・実装はしていない。判断・着手は次のエージェント(Fable)に委ねる**）。P1/P3/P4は済でP2/P5は未着手のままと確認。優先度が一番高いと判断したのはP2（`TimelineView.tsx`の「もっと見る」がlimit増の全件再取得のまま）。あわせて今回自分が入れたP6（タスク16残作業の`refreshMemberFromSheetLive`が'sheet'部員のマイページ表示に毎回GAS呼び出しを挟む設計）も新規にメモ化。詳細はタスク5節参照 → (このcommit)
- 2026-07-10 / Claude Code (Sonnet 5) / オーナー指示「練習記録は1日1つ」を明示化。RecordForm.tsxの新規作成モード（FAB経由）で、日付を選ぶたびその日の既存記録をDB検索し、あれば実質「編集」としてフォームへ内容を読み込むよう変更（従来は空欄のまま保存でき、未入力項目がnull/0で上書きされ既存内容が消える恐れがあった）。既存の同日dedupロジック（submit時にsameDayを検索しupdateへ回す）は変更なし・そのまま安全網として残置。見つかった日は案内文表示＋保存ボタンを「更新する」に変更。**オーナー確認: この1日1件ルールはDBをSupabase単独に統合した際に見直す可能性があるため、コードコメントにその旨明記**。tsc/lint/build成功。**オーナーが実機で動作確認済み（2026-07-10）** → (このcommit)
- 2026-07-10 / Claude Code (Sonnet 5) / タスク16残作業「個人の記録画面のCSV/fetchMember直読み化」を実装。オーナー報告（'sheet'切替後もスプシの内容が反映されない）を受け着手。マイページ・自分の`/members/[id]`表示直前に`fetchMember`で本人分だけ軽量取得し毎時cronを待たず非破壊pullする`refreshMemberFromSheetLive`(`sheet-sync.ts`)＋`refreshOwnSheetRecords`(`queries.ts`)を追加。cronの`runSheetSync`側pull-onlyロジックは`computeMemberPull`として共通化しただけで**挙動は不変**（純粋な抽出、本番cronへの影響なし）。GAS呼び出しは5秒タイムアウト・失敗時は例外を投げずDBの現状のまま表示（ページを壊さない設計）。tsc/lint/build成功。**実機確認は未実施**（特に：スプシへ直接入力した内容がマイページ再訪で即座に反映されるか、GAS遅延時にページ表示が極端に遅くならないか） → 7ae16bd
- 2026-07-10 / Claude Code (Sonnet 5) / タスク16（練習記録のスプシDB化）を実装・本番反映。RecordFormの'sheet'閲覧専用ブロック撤去、write-through保存(`/api/sheets/push-record`)、GAS拡張(`fetchMember`アクション追加・`writeCells`のunmapped返却。clasp deploy @6で本番反映済み)、RecordCard/PostOwnerMenuの編集可否をrecord_source考慮に変更。**dry-runで実際に危険な誤検知を発見**: 再送判定を`appIsNewer`(updated_at>synced_at)にしていたところ、'sheet'部員6名・8件の無関係な過去の時刻ズレを再送対象と誤検知し、部員がスプシへ直接入力した内容を古いアプリ値で上書きしかねない状態だった。専用フラグ`practice_records.pending_sheet_push`(migration 20260710100000)に設計変更し、再dry-runで`pushed:0`を確認してから適用(Local/Remote一致確認済み)。tsc/build成功。**個人記録画面のCSV直読み化・実機確認は未着手**（詳細はタスク16節の「残作業」参照）。100人規模でfetchAllRawが65部員で約70秒かかることを実測、既存のmaxDuration=60と衝突する可能性がある既存リスクを発見・記録 → (このcommit)
- 2026-07-09 / Claude Code (Fable 5) / タスク15を削除（オーナーがシートに感想見出しを追加して解消・報告受領）。「未マップ項目の可視化」はタスク16へ引き継ぎ。キュー最前列はタスク16のみに。コード変更なし → (このcommit)
- 2026-07-09 / Claude Code (Fable 5) / オーナー確定を受けタスク16を「練習記録のスプシDB化」（'sheet'部員＝旧TF方式: CSVエクスポート直読み＋GAS write-through、Supabaseはいいね/コメント/タイムライン用ミラー、いいね・コメント・時刻は全部員Supabaseメイン）に全面改稿。コード変更なし → (このcommit)
- 2026-07-09 / Claude Code (Fable 5) / タスク15の真因特定（実物スプシをCSVエクスポートで確認: 感想/コメント見出しが無い部員タブが実在し、名前マッピングが黙ってスキップ。B2駒井タブで実測）・タスク15/16に調査結果を反映（pull読み取りのCSVエクスポート直読み化＝オーナー指摘を16に追記）。あわせて記録フォームの「結果・タイム」ラベルを「結果」に変更（オーナー指示。RecordForm/RecordCard/RecordFieldsSetting）。tsc/build成功・**実機確認は未実施** → (このcommit)
- 2026-07-09 / Claude Code (Fable 5) / オーナー指示によりバックログにタスク15（感想欄がスプシに反映されないバグ・キュー最前列）とタスク16（'sheet'部員のハイブリッド入力＝write-through、旧TF方式・部員100人想定）を追記。着手順にも最前列の注記を追加。タスク2の「'sheet'部員は編集不可」は16が上書き。コード変更なし → fc7c66e
- 2026-07-08 / Claude Code (Sonnet 5) / オーナー再報告により訂正: 前項のPWAマニフェストアイコンの話ではなく、**プロフィール編集の「アイコン画像URL」欄**の話だった。Avatar.tsx(共通コンポーネント)は avatarUrl があれば無条件でimgタグを出すだけで、読み込み失敗時(リンク切れ・Googleドライブ共有リンク等の直リンクでないURL)は崩れた画像アイコンのまま表示されるバグ。onErrorでイニシャル表示にフォールバックするよう修正し、ProfileEditFormに直リンクが必要な旨の注記を追加。tsc/build成功。**実機確認は未実施** → d356c0f
- 2026-07-08 / Claude Code (Sonnet 5) / オーナー報告「ホーム画面に追加してもアイコンが？になる」を修正。manifest.tsのiconsがicon.svg(sizes:any, image/svg+xml)のみで、AndroidのChromeインストール時にSVGアイコンが解決できず「?」プレースホルダになっていたのが原因。next/ogのImageResponseでicon-192.png/icon-512.png(purpose:any)・icon-maskable.png(purpose:maskable、角丸無しの全面塗りつぶし)をroute handlerとして生成しmanifestに登録。ローカルでdev起動し3つとも200/image/pngで実際にPNGが生成されること・manifest.webmanifestの内容を確認済み。tsc/build成功。**実機(Android/iOS)でのホーム追加後の見た目確認は未実施** → 23a6573
- 2026-07-04 / Claude Code (Sonnet 5) / 簡単なものから消化: タスク4-S4(Bearer比較をtimingSafeEqualに、src/lib/timing-safe.ts新設)、タスク12(コメント最大500字・migration 20260704190000、RecordFormのカスタム項目フェッチをprops経由に・FAB新規作成パスのみ配線)、タスク5-P4(fetchCommentCountsをDB側GROUP BY RPC化・migration 20260704200000)、タスク5-P1(getUserRecordsのfromDate省略時を無期限→直近400日、getNoticesに直近200件、getPersonalNotificationsに直近50件のlimit追加)。tsc/lint/build成功・本番反映済み。**実機確認は未実施**。タスク12の「⋯ボタン統一」、タスク5の残り(P2/P3/P5)は未着手 → ed45fa5, be84403, 1287d13, 0063fbf
- 2026-07-04 / Claude Code (Sonnet 5) / インシデント再発防止2点を実装。①タスク2追加要件「切替時リコンサイル」: record_source切替の直前にその部員だけ一度だけ非破壊で両側を揃える(reconcileOnSwitch、/api/sheets/reconcile、ProfileEditForm.save)。app→sheet切替はアプリの中身のある項目をシートへ、sheet→app切替はシートの中身のある項目をアプリへ。失敗したら切替自体を中止。②タスク14を部分実装: sheet-sync.tsのpush/update処理を部員単位でtry/catchし1人の失敗で全員の同期を止めない部分失敗設計、10分以上running放置されたrunをerrorへ倒すクリーンアップ、SheetSyncButtonに失敗詳細表示。migration 20260704180000(sheet_sync_runs.failed_members)本番適用済み。**タスク14の残り(連続失敗アラート・シート名不一致の可視化)は未着手**。tsc/lint/build成功。**実機確認・実際のreconcile/sync動作確認は未実施**（特にreconcileはGAS通信を伴うため、次の入力元切替操作で実際に動くか要確認） → 829e92d, 6fc790f
- 2026-07-04 / Claude Code (Sonnet 5) / **タスク0 真因特定・修正・完了**。オーナーの再現報告(「追加する」を押すと保存するを押す前にモーダルが閉じる)を元に特定: `FullScreenContent`(fullscreen.tsx)のonPointerDownOutsideが、Select等のRadixポップアップは除外していたが入れ子のSheet(RecordFieldsSettingの追加項目用ボトムシート、Dialog.Root)は対象外だった。SheetはPortalでdocument.body直下に描画されるため中をタップすると外側クリックと誤判定され、親のフォームモーダルごと閉じていた。role="dialog"を許可リストに追加して修正。tsc/lint/build成功・本番反映済み。**実機確認は未実施だが原因は構造的に特定できており高確度**。この不具合パターン(入れ子Dialog全般)は他の画面にも影響しうるため注意 → 7ef0a3d
- 2026-07-04 / Claude Code (Sonnet 5) / pg_cron確認・予定取込cron登録。`npx supabase db query --linked`（Management API経由でcron/vaultスキーマにも到達可能。過去に「CLIでは呼べない」と誤って案内したが訂正）で状態確認: sheet-sync-hourly(記録同期)は1件のみ稼働中・vault秘密(sheet_sync_secret/sheet_sync_url)も健在で正常。オーナー承認のうえ、vault.create_secret('schedule_import_cron_url')＋cron.schedule('schedule-import-hourly', '5 * * * *', ...)で予定/メニュー自動取込(`/api/schedule-sheets/cron-sync`)を**別名で**新規登録。実行後にcron.jobを再確認しjobid 1(sheet-sync-hourly)・jobid 2(schedule-import-hourly)が両方activeで名前衝突が無いことを確認済み。コード変更なし → (このcommit)
- 2026-07-04 / Claude Code (Sonnet 5) / 【インシデント対応】オーナーから「過去に入力した記録が消えた」報告。本番DBを直接調査し確認: タスク2+3で入れた「'sheet'方向はシートの空欄もアプリへ反映してよい」仕様が、2026-07-03 17:00の自動同期(hourly cron)で実際に発動し、山端さんの練習記録3件(6/24, 6/29, 7/1)がスプシ側の空欄で上書きされ消失。7/1分は消える1.5時間前にアプリで入力されたばかりだった。①sheet-sync.tsのpull処理を「空でないシート項目だけ取り込む」非破壊の挙動に戻した(5de45d5)。②record_source='sheet'の記録編集画面が実際にはデータが無事なのに「編集できません」というメッセージだけを出して中身を全く見せない作りだったため、これも「データが消えた」ように見える別のUIバグと判明(駒井さんの件はこれが原因で実データは無事)。読み取り専用表示に修正(e9093c6)。**根本論点として、'sheet'方向はアプリ入力が一切スプシへ書き戻されない設計であることをオーナーに説明し、この安全性について要相談中**。消えた3件のデータ自体は復元できていない(要:オーナーとPITR等の復旧要否を相談)。tsc/lint/build成功・本番反映済み → 5de45d5, e9093c6
- 2026-07-04 / Claude Code (Sonnet 5) / タスク10-b（予定スプシの自動取込pg_cron）着手・完了。オーナー提供の実物スプシURLで実構造を確認したところ、**日付列の見出しが「日付」ではなく数字("2")で、既存のヘッダー名一致方式では全行が日付エラーになり一切取り込めない重大バグを発見・修正**（practice kindは先頭列=日付を位置ベースで扱うbuildHeaderRow）。schedule-import.tsにメニュー/ペース/補足/補強列を追加認識し、時間・場所・メニューのいずれかがあれば予定として取込むよう修正（実物仕様どおり）。apply_schedule_sheet_import RPC(migration 20260704170000)を拡張し、単一ブロック指定の行なら予定と同時にブロック全体メニューも生成/更新。新規 `/api/schedule-sheets/cron-sync`（Bearer認証・SHEET_SYNC_SECRET共用・非破壊・admin client直書き）を追加、proxy.tsのBearer専用パスにも登録。**pg_cron登録SQLはオーナーに案内済み・実行待ち**（Supabase SQL Editorで一度だけ実行。docs/SHEETS-SYNC-PLAN.md §7と同じVaultパターン、新規Vercel環境変数は不要）。補強列だけの日（時間・場所・メニュー無し）は予定にならないためメニュー化されない既知の制限あり（practice_menus.schedule_id NOT NULL制約のため今回は対応見送り）。tsc/lint/build成功。**実機確認・実際のcron動作確認は未実施** → 77c7ddb
- 2026-07-04 / Claude Code (Sonnet 5) / オーナー指摘3点を修正。①タイムラインのスプシ由来記録表示(タスク3で追加)を recorded_date >= 2026-07-04 のものだけに限定(SHEET_TIMELINE_CUTOFF定数、queries.tsのgetFeed/getUserActivity)。連携直後に古い記録が一気に流れ込む事故を防止。マイページ集計(getUserRecords)は従来どおり全期間。②migration 20260704160000でprofiles.sheet_linked_at追加(sheet_name設定トリガーで自動記録)。sheet-sync.tsのpull側カットオフをSYNC_CUTOFFとsheet_linked_atの遅い方に変更し、新規連携者は連携日以降のみ取り込み。既存連携済み部員はsheet_linked_at=NULLのままなので影響なし。③ProfileEditFormのシート選択欄が候補取得中は欄ごと非表示で遅れて出現していたのをSkeleton表示に変更。tsc/lint/build成功・**実機確認は未実施** → c906c5e
- 2026-07-04 / Claude Code (Sonnet 5) / オーナー指摘2点を修正。①メニューのスプシ/CSV一括登録は予定作成画面ではなく「メニューを追加」画面内(MenuCreatePanel、通常入力/スプシ・CSVから入力の切替)に移動。②中長距離のメニュー項目に「補足」(remark)が抜けていたため追加、表示・入力・CSV列順を メニュー→ペース→補足→補強 に統一。「詳細」ラベルは「メニュー」へ改称。migration 20260704150000（practice_menus.remark追加・save_practice_menu RPCにmenu_remark追加）本番適用済み。tsc/lint/build成功・**実機確認は未実施** → 9f21e81
- 2026-07-04 / Claude Code (Sonnet 5) / タスク11-a（メニューのプリセットを「過去メニューから複製」に置き換え）着手・完了。MenuForm.tsxのlocalStorageプリセット保存・上書き・削除・旧DBプリセット移行コードを全撤去し、自分が過去に公開したメニューを新しい順(検索可)で複製できるピッカーに置き換え。直近値の自動初期値(対象者引き継ぎ)は維持。DBマイグレーションなし(menu_target_presetsテーブルは未使用のままDBに残置、削除は未実施)。tsc/lint/build成功・**実機確認は未実施**。**11-b（予定のある日を複数選択してまとめて入力）は未着手**。番号順ではこの後タスク12（細かいUI改善）へ進む → 4c5cbcb
- 2026-07-04 / Claude Code (Sonnet 5) / タスク10（予定の一括運用）に部分着手。実物スプシの現物が手元に無い（URLは公開リポのため非掲載・オーナーのみ保有）ため、安全に検証できる範囲のみ実装: schedule-sheets/preview/route.tsに見出し行自動検出（冒頭メモ行を読み飛ばし「曜日・時間・場所」を含む行を探す）、schedule-import.tsに対象年月±1ヶ月の許容（月またぎ対応）、既存予定の突合クエリも同範囲に拡張。**a)ワンタップ再取込導線・b)pg_cron自動取込・c)アプリ内表形式一括入力・メニュー列からのpractice_menus自動生成は未着手**（実物CSVでの検証が前提条件のため）。tsc/lint/build成功・DBマイグレーションなし。次のエージェントは可能なら実物CSVでこのパーサ変更を検証してから残りに着手すること。番号順ではこの後タスク11（メニュー作成の手間削減）へ進む → ce92322
- 2026-07-04 / Claude Code (Sonnet 5) / タスク2+3（スプシ同期の方向固定＋タイムライン表示）着手・完了。migration 20260704140000でprofiles.record_source('app'|'sheet'、sheet_name連携済みは'sheet'初期値)を追加・本番適用。sheet-sync.tsをpull-only('sheet')/push-only('app')に再構成しLWW・コンフリクトスキップを撤去、practice_records読み込みにSYNC_CUTOFFフィルタ追加。ProfileEditFormに入力元切替UI追加、'sheet'の部員はRecordForm(新規/編集とも)をアプリから使えないようブロックし案内文表示。from_sheetをinsert時のみ設定に統一。queries.tsのgetFeed/getUserActivityからfrom_sheet=falseフィルタ撤去でスプシ由来記録もタイムライン表示。tsc/lint/build成功。**実機確認・実際の同期動作確認は未実施**（特にpull時の空欄反映・push時のシート上書きの実データでの確認が必要）。この後タスク10（予定の一括運用）へ進む → 936da59
- 2026-07-04 / Claude Code (Sonnet 5) / タスク6-Q3（JST共通util化）+タスク7（記録フォーム未来日ブロック）着手・完了。`src/lib/date.ts`にjstToday/jstNowを新設し、queries.ts内の重複dateInJapanと、UTC基準バグだった`new Date().toISOString().slice(0,10)`（queries.ts/MenuForm.tsx/ScheduleSheetsManager.tsx）を置き換え。home/page.tsxのnowJst計算も統一。RecordFormの日付にmax属性＋送信時バリデーションを追加。DBマイグレーションなし。tsc/lint/build成功・**実機確認は未実施**。この後タスク2＋3（スプシ同期の方向固定・タイムライン表示）へ進む → 7793d5d
- 2026-07-04 / Claude Code (Sonnet 5) / タスク1（承認ゲート廃止）着手・完了。migration 20260704130000（approvedのDEFAULT TRUE化＋既存FALSE行バックフィル）を本番適用。layout.tsxのリダイレクト撤去、/pending route削除、ホーム承認バナー・members承認UI・PendingApprovals・getPendingProfiles・PendingProfile型を撤去。approved列・is_member()・set_member_approved RPCはDBに残置（指示通り）。tsc/lint/build成功。**実機確認は未実施**。この後タスク6-Q3(JST統一)とタスク7(未来日ブロック)へ進む → 1b6144e
- 2026-07-04 / Claude Code (Sonnet 5) / オーナー割り込み依頼（バックログ番号外）: ①メニューにcontentとは別枠の pace/supplement（ペース/補強、中長距離向け）追加 ②メニューのスプシ/CSV一括登録（予定と同じ体験。対象日の既存予定に紐付け必須、schedule-import.ts型を流用したmenu-import.ts新設、/api/menu-sheets/preview、MenuSheetImportManager.tsx、予定FABを3択化） ③予定の一括登録直後の取り消し（source_sheet_id+created_at基準の再取得→まとめて削除。削除候補リストもチェックボックスで実削除可能に）。migration 20260704120000 本番適用済み・Local/Remote一致確認済み。tsc/lint/build成功。**実機/ブラウザでの動作確認は未実施**（CSVインポートのプレビュー→反映、中長距離メニューのペース/補強入力、予定取込の取り消しボタン、削除候補チェックボックス削除の4点は次のエージェントか実機で要確認）。この後バックログ番号順（タスク1: 承認ゲート廃止）へ復帰 → 67256ee, 48111af, e4845b4
- 2026-07-04 / Claude Code (Sonnet 5) / タスク0（記録フォーム設定保存バグ）着手。Vercel本番デプロイが最新コミット反映済みを確認（調査手順0クリア）。RecordFieldsSetting/FormModalFooter/ReorderList/safe-updateを読み込み静的解析したが確定原因は特定できず。addField/saveの例外握り潰しの可能性を排除する防御的fix（try/catch＋メッセージ表示、crypto.randomUUID未対応時のフォールバック）を実装しpush。**実機（iOS PWA）での「追加→一覧に見えるか→保存→再度開いて残っているか」の再現確認が未完了。次のエージェントはまずオーナーに実機確認を依頼すること** → 5831ec2
- 2026-07-03 / Claude Code (Fable 5) / バックログ10〜12を追記（予定のワンタップ/自動取込・表形式一括入力、メニューの履歴複製・まとめて入力、⋯統一・コメント500字ほか）。@All確定も反映。コード変更なし → 7a3d881ほか(このcommit)
- 2026-07-03 / Claude Code (Fable 5) / 全体コードレビュー→オーナー確定の実装バックログを本ファイルに追記（コード変更なし）。承認ゲート廃止・同期の方向固定(record_source)・スプシ由来記録のタイムライン表示ほか。実装は番号順に別エージェントが担当 → (このcommit)
- 2026-06-29 / Codex / ロール権限にシステム管理を追加。通常管理者の権限昇格と最後の管理者解除をDBで防止し、システム管理者だけ自己投稿お知らせ通知を受信。migration 20260629130000本番適用、組込管理者への付与・通知設定ON・Push購読確認、tsc/対象Lint/build成功 → 完了
- 2026-06-29 / Codex / ホームをSuspenseでストリーミング表示、プロフィール取得重複排除、設定/D&D遅延ロード、主要DB索引追加。お知らせ通知先を全員/複数ロール対応、ベル赤丸をRealtime更新。migration 20260629120000本番適用、tsc/対象Lint/build成功 → 完了
- 2026-06-29 / Codex / 記録フォームをiPhoneホーム編集風の全画面エディタへ刷新、項目名完全一致時のみスプシ同期、全画面Pull-to-refresh、ホームの承認待ち導線、同期ボタン1タップ化。tsc/対象Lint/build成功 → 完了
- 2026-06-29 / Codex / 過去方針の残タスクを文書上でリセット（コード変更なし）。新規登録者の承認ゲートの現状と本番DB適用を確認 → `TASK-codex.md`をアーカイブ化、HANDOFFのアクティブバックログを「なし」に更新
- 2026-06-24 / Claude Code(Codex実装をレビュー適用) / セキュリティ修正を本番適用。RLSのSELECTが USING(TRUE)+public でanonキー単体で profiles(実メール)・記録・ノートが読めた脆弱性を是正。migration 110000(SELECTをTO authenticated＋REVOKE anon)・120000(profiles.approved 承認ゲート/is_member()でSELECT限定/approved直接UPDATE剥奪＋RPC set_member_approved=承認済みなら誰でも承認可/profilesは自分の行のみ例外)。回帰: anonで /rest/v1/profiles → 401 permission denied 確認。tsc/build OK → (このcommit)
- 2026-06-24 / Claude Code / アプリの記録コメントを旧TF式にスプシのリプライ列(感想列の右・列名なし列)へ書き込み。GAS sync-api に writeReply 追加(clasp で安定URL@3に更新)・/api/sheets/reply(作者のsheet_name+日付を引き「{コメント}　{投稿者名}」で書込・作者未連携ならskip)・CommentSectionから記録コメント時に呼ぶ(fire-and-forget) → (このcommit)
- 2026-06-24 / Claude Code / 練習記録同期を本番稼働。GASは手貼り沼を脱しclaspでCLIデプロイ(個人acct, gas/sync-clasp/, secretなし・公開web app)。proxy/middlewareで /api/sheets/sync をBearer用に素通り許可。Vercel: SHEET_SYNC_GAS_URL=新URL/SHEET_SYNC_ENABLED=true 設定。BearerでdryRun→本反映を検証(2件取込・再実行0件=冪等)。残: 毎時cron(pg_cron SQLをユーザーがSupabaseで実行) → (このcommit)
- 2026-06-24 / Claude Code / 表示分離＋カスタム項目並び替え＋GAS分離。①practice_records.from_sheet追加(migration 20260624100000)。シート由来(from_sheet=true)はタイムラインに出さず、アプリ投稿のみ表示(getFeed/getUserActivity)。マイページ集計(getUserRecords)は両方合算。②カスタム項目を上下で並び替え(ProfileEditForm)。③同期pullはfrom_sheet=trueで挿入(sheet-sync.ts)。④旧TFアプリ用GAS(TF/gas/Code.gs)は原状復帰、本アプリ用は別GAS(track-app/gas/sync-api.gs・secret付き)を別URLでデプロイする方針に → (このcommit)
- 2026-06-23 / Claude Code / スプシ同期を安全に作り直し。①応急(15c31ed): 表示を6/22以降・未来除外・空除外に+同期停止。②空/未来のゴミ55行をDB削除(REST,残59)。③再設計: カットオフ/未来/空スキップ・非破壊(空でアプリ/シートを潰さない)・複数記録/日はconflictスキップ・dryRun対応(lib/sheet-sync.ts)。④/api/sheets/sync は dryRun常時可/本番反映は env SHEET_SYNC_ENABLED=true 必須。⑤手動ボタンを「確認(ドライラン)→反映」式に。⑥カスタム項目は項目名=スプシ列名に統一 → (このcommit)
- 2026-06-23 / Claude Code / スプシ(TF構造)⇔練習記録の双方向同期を実装。GASブリッジ(fetchAllRaw/writeCells/listMembers＋日付ベースの汎用ヘッダー検出＋共有secret, TF/gas/Code.gs)・見出し名ベースのマッピング同期(lib/sheet-sync.ts, last-writer-wins)・/api/sheets/{sync,members}・プロフィールでシート選択＋記録フォームのカスタム項目(profiles.record_fields/practice_records.custom, 短距離の独自列対応)・RecordForm動的描画・管理者の手動同期ボタン・pg_cron手順(docs/SHEETS-SYNC-PLAN.md)。migration 20260623100000。menu同期はフェーズ2 → (このcommit)
- 2026-06-22 / Claude Code / PWA未起動の人にホーム画面追加を促すバナー追加(InstallPrompt: Androidはbeforeinstallpromptでワンタップ追加/iOSは手順案内/スタンドアロン時は非表示/閉じたら5日再表示しない) → (このcommit)
- 2026-06-22 / Claude Code / タイムラインのつぶやきカードに学年表示を追加(記録カードと同様/TweetCard) → (このcommit)
- 2026-06-22 / Claude Code / RLSを戻し作成者は自分のメニューを常時閲覧可に(migration 080000)・通知設定を端末通知ON/OFF一本化(ONでブラウザ許可ダイアログ/別建ての有効解除ボタン廃止/ON時のみ種類トグル)・メニュー並びを作成日時非依存の固定順(全体→個別/対象者名順)に → (このcommit)
- 2026-06-22 / Claude Code / 他ブロック閲覧オフでも作成者に他ブロック公開メニューが見える不具合修正(RLS:作成者常時可は下書きのみに/migration 070000)・予定メニューの並び順を作成順で固定(queries埋め込みorder)・「設定」をマイページに新設し通知設定+メニュー表示を展開式(details)で同居・メニュー表示設定を管理者限定から全員に開放(NotificationSettingsButton廃止) → (このcommit)
- 2026-06-22 / Claude Code / 対象者選択を別画面(全画面モーダル)に分離して本体フォームを短縮・メニューカードの⋯を右上絶対配置にして空白行を除去 → 1ab436d
- 2026-06-22 / Claude Code / 用語統一: メニュー種類を「ブロック全体/個人を指定」、ブロック見出しを「ブロック」に統一 → bbebae8
- 2026-06-22 / Claude Code / 他ブロック設定の表示が戻る不具合をrouter.refreshで修正・ブロック共通メニュー上の空白除去・メニュー対象者に検索とブロック絞り込みを追加 → 3a495ce
- 2026-06-22 / Claude Code / メニューをブロックごとにグループ表示(#5)・他ブロック閲覧の個人設定をマイページその他に追加(profiles.menu_view_all_blocks+RLS,既定off,#6)・重要お知らせを✗で消せないように・予定詳細の二重区切り線を解消 → e2857ff
- 2026-06-22 / Claude Code / プリセットをシート選択+⋯編集に刷新(Select不具合解消)・プリセットに本文/ブロックも保存・予定メニューを対象/自ブロックで色分けハイライト・モーダル外クリック誤判定でDialogが閉じる不具合修正 → 73637b2
- 2026-06-22 / Claude Code / メニュー追加ボタンを破線ボタンで明確化＋下書きカードに「公開する」ワンタップ公開ボタン追加 → 9723d7b
- 2026-06-22 / Claude Code / 個別メニューにブロック付与＋同ブロックは閲覧可(RLS更新)、予定カードで自分関連メニューを上位表示、メニュー種類のチラつき再対策 → 1b2609e
- 2026-06-22 / Claude Code / いいね長押しで「いいねした人」シート表示＋戻るボタンの確実化(router.back無反応時fallback)＋メニュー種類の初期表示チラつき解消(直近の種類で開く) → 87fed77
- 2026-06-22 / Claude Code / ノート: フォルダ作成をFABへ統一（/notesでFAB表示・NotesViewの旧ボタン撤去）＋記事一覧に編集(⋯)導線を追加（短い記事も編集可能に） → af734b3
- 2026-06-22 / Claude Code / お知らせ通知タップで該当お知らせへ（タブ切替+スクロール+展開）＋お知らせを折りたたみ表示（基本タイトル/タップで展開）に → e1d8105
- 2026-06-22 / Claude Code / お知らせに「メンバーに通知する」トグル追加（notices.notify_members＋トリガー条件分岐）＋ホームの重要/通常お知らせ混在時の枠被り修正（Linkをblock化） → d2397e8
- 2026-06-22 / Claude Code / キーボード表示時のフォーム揺れ解消: FullScreenContentのvisualViewport追従をReact再描画→ref直接更新+rAF間引きに（毎イベント再描画が原因のぐらつきを除去） → 55e5480
- 2026-06-22 / Claude Code / 通知設定をマイページのリスト（目標等の並び）へ移設＋入力欄の自動ズーム対策（Input/Textarea/スプシ入力を16px以上に＝iOSのガクつき解消） → b45771d
- 2026-06-22 / Claude Code / Web Push基盤を本番投入: VAPID secrets登録/Edge Function send-web-push デプロイ/Vercel env(公開鍵)/pg_netで通知INSERT→push のwebhookトリガー。本番DBへ全マイグレ適用済み（バグ修正含む＝コメント/お知らせ投稿の不具合解消） → 7d0f93a 他
- 2026-06-21 / Claude Code / 予定(schedule_update)通知を廃止（トリガー/関数/notify_schedule列/UI/型/Edge関数）。コメント＋お知らせのみに → a07843f
- 2026-06-21 / Claude Code / 通知トリガーの列名バグ修正（active→status / 予定列名 / notices.author_id）＋重複マイグレ削除 → ac94ce0
- 2026-06-21 / Antigravity / 通知機能（Phase 1-3）実装 → 列名バグ等を Claude が修正のうえ本番投入。以後 Antigravity の運用は終了
- 2026-06-21 / Claude Code / 通知機能の仕様書 `docs/NOTIFICATIONS-PLAN.md` 起案（実装はAntigravity担当）→ (このcommit)
- 2026-06-21 / Claude Code / AGENTS.md 運用ルール整理（署名・報告ルール・HANDOFF優先）→ ed4c8c4

## 着手前の確認：何が「未実装」かを誤認しない
- **未実装かどうかの判断は必ず `docs/CLAUDE-HANDOFF.md`（最新の実装状況）を正とする。**
- `docs/UX-ISSUES-2026-06.md` / `docs/UI-AUDIT.md` / `docs/UI-UNIFICATION.md` は**過去の課題台帳・方針**で、**すでに実装済みの項目を「未実装」と書いたまま残している**ことがある。これらを根拠に「作り直し」をしない（完成済み機能を壊す事故の原因）。
- 「直す前」に対象機能の現状コードを確認し、すでに動いているなら HANDOFF を信じてスキップ／微修正に留める。

## 実装の型（要点）
- 初期データは Server Component ＋ `src/lib/queries.ts` に集約（画面に直接 supabase を書かない）。操作系は Client Component。
- 権限：UI は `permissionsOf(profile.roles)`、DB は `can_*()` / `is_admin()` / `is_staff()` で RLS。ロールは `profile_roles`×`roles`（複数ロールを OR で判定）。
- 学年表記は `B1/B2/B3/B4 ・ M1/M2 ・ D1/D2/D3`（`gradeShort` / `GRADE_OPTIONS`）。
- **update は RLS で弾かれても「エラー無し・0件」で無言失敗する**。重要な更新は `.select()` で件数確認し、0件なら `auth.refreshSession()`→再試行→明示エラー（実例 `src/components/post/ScheduleForm.tsx`）。

## 注意：README は人間向けセットアップ用
`README.md` の「実装状況」欄や `profiles.role='admin'`（旧シングルロール方式）は **古い**。最新の状態は本ファイルと `docs/CLAUDE-HANDOFF.md` を正とする。

## Claude handoff — 2026-07-12 tab lab D result and queued UX work

- Tab Lab D (real schedule <-> real home, inactive DOM unmounted) owner result: 100 switches, average 30ms, worst 64ms, max event-loop stop 24ms. No freeze was reported. DOM nodes by tab in display order: Home 237, Schedule 888, Timeline 47, Notes 47, My Page 47.
- Interpretation: cost rises with the real screen DOM, but the isolated client-owned switch path remains responsive for 100 switches. This supports replacing bottom-tab Next Router transitions with a client tab shell that unmounts inactive screen DOM/state. Codebase line count itself is not the cause; route retention/reactivation and the amount of mounted DOM/work are the relevant variables.
- Lab commits already pushed: `199d61c` (A/B/C) and `ba46bf7` (D). Do not treat the lab as production navigation yet.
- Owner explicitly asked Claude to take part of the remaining work because of Codex token limits.

### Next work requested by owner (not implemented yet)

1. Make additions, edits, and deletes of practice records and tweets (and similar mutations where practical) appear immediately in local UI, instead of waiting for `router.refresh()`/server re-render. Use an optimistic/shared client cache and rollback on failure. Ensure both HomeFeed and TimelineView stay coherent, including hidden/restored routes.
2. Home attendance counts must update immediately. Full `ScheduleCard` already does local state. The confirmed gap is the compact `upcomingSchedules` card in `src/app/(app)/home/page.tsx`: its `present`/`absent` counts are fixed server values and its direct `AttendanceToggle` has no `onChanged`. Extract/use a client card with local status/count state; AttendanceToggle already calls `onChanged` optimistically and again with the previous state on failure.
3. Splash: make the final blue TUAT scene transition to Home with the same white-flash/brightening feel used between the earlier scenes. Current `SplashIntro.tsx` removes at `FINISH_AFTER_MS=4380` after only 80ms; CSS `.flash` only runs `flash-between`. Add a final flash state/animation, then reveal Home near peak white without layout flash.
4. Implement and commit these as separate logical tasks, run `npx tsc --noEmit` and `npm run build`, update this log, then push.

### Worktree state at handoff

- Clean. Codex briefly created an untracked draft `UpcomingScheduleCard.tsx`, but removed it before this handoff because it was incomplete. No implementation from the queued work should be assumed present.
- 2026-07-13 / Codex / 季節別ブランド画像の夏版を実装。オーナー提供の夏TFアイコンを原本として、PWA 192/512、Apple 180、maskable 512（安全領域版）、favicon ICO/32、1024原本、OG/Twitter 1200x630を`public/branding/summer-*`へ生成。manifestとroot metadataを季節名付きURLへ接続し、OG/Twitter large image・apple-touch-icon・faviconを設定。SW事前キャッシュも夏アイコンへ変更。`npx tsc --noEmit`/`npm run build`成功。共有カードは夏絵の具背景＋左アイコン＋Archivo BlackのTUAT T&F。実機ホーム画面再追加およびSNSキャッシュ更新はオーナー確認待ち。