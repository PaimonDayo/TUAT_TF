<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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
> **番号順に着手し、1タスク＝1コミット**。着手前に対象コードの現状を必ず確認すること。
> マイグレーションは従来どおり新タイムスタンプ＋冪等で作成し `"Y" | npx --yes supabase db push` で本番適用。

### 前提となる方針転換（オーナー決定・全タスクに影響）
- **承認ゲート（profiles.approved）は廃止**する。理由: 部外の同大生が入ってくる可能性は実質なく、承認フローが不便。部外生ログイン時の閲覧リスクはオーナー了承済み。
- **スプシ同期は双方向をやめ、部員ごとに方向を固定**する（record_source）。LWW・競合スキップ等の複雑さを撤去する。
- **スプシ由来の記録もタイムラインに表示**する。「同期した時刻に投稿されたもの」という扱い（created_at＝取込時刻のまま並べてよい）。

### 1. 承認ゲート廃止
- migration: `profiles.approved` を DEFAULT TRUE 化し、既存の FALSE 行を TRUE にバックフィル。新規ユーザー作成トリガー（handle_new_user 相当）も approved=TRUE で作ることを確認。**approved 列と is_member() は残す**（RLSポリシー群は書き換えない。全員 TRUE になるので実質 authenticated ゲートとして機能し続ける）。
- `src/app/(app)/layout.tsx` の `if (!profile.approved) redirect("/pending")` を撤去。`src/app/pending/` を削除。
- `src/app/(app)/home/page.tsx` の PendingApprovalBanner、`queries.ts` の getPendingProfiles、members 画面の承認UI（set_member_approved 呼び出し）を撤去。RPC 自体はDBに残してよい。

### 2. スプシ同期を「部員ごとの方向固定」へ（最重要）
- migration: `profiles.record_source TEXT NOT NULL DEFAULT 'app' CHECK (record_source IN ('app','sheet'))`。バックフィル: **sheet_name 連携済みの部員は 'sheet'、未連携は 'app'**（従来のスプシ取込を切らさないための初期値。部員には切替方法を周知）。
- `src/lib/sheet-sync.ts` を再構成:
  - record_source='sheet' の部員 → **pull のみ**（シート→アプリ、from_sheet=true）。シートを正とし、マップ済み項目はシートの空欄も反映してよい。シートに行が無い日は触らない（安全側）。アプリ→シート書き戻しはしない。
  - record_source='app' の部員 → **push のみ**（アプリ→シート）。シート側のマップ済みセルは同期が上書きしてよい（シート＝写し）。シート→アプリ取込はしない。
  - これに伴い LWW（appIsNewer / updated_at・synced_at 比較）、同日複数記録の conflict スキップ、双方向前提の空値保護ロジックを撤去・簡素化。SYNC_CUTOFF・未来日除外・dryRun・sheet_sync_runs ログ・手動同期ボタンは維持。
  - practice_records の読み込みに `.gte("recorded_date", SYNC_CUTOFF)` を付ける（下記 5-P3 と同時解消）。
- UI: ProfileEditForm のシート選択の隣に「記録の入力元: アプリ / スプレッドシート」切替を追加。'sheet' の部員は自分の記録をアプリ内で**編集不可（閲覧のみ）**にし、「入力元をアプリに切り替えると編集できます」と案内。
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
- P1: `queries.ts` getNotices / getPersonalNotifications / getUserRecords（fromDate なし呼び出し）に limit または期間窓（通知は直近50件＋ページング目安）。
- P2: `TimelineView.tsx` の「もっと見る」を limit 増の全件再取得から**カーソル式**（最後の created_at より古い分を追加取得）へ。
- P3: sheet-sync の全履歴取得に `.gte("recorded_date", SYNC_CUTOFF)`（タスク2と同時）。書き戻しの直列 GAS 呼び出しは可能なら一括化。
- P4: `queries.ts` fetchCommentCounts を全行取得→JS集計から count 集計へ。
- P5: getFeed の limit 後フィルタ問題は、タイムラインがクライアント側フィルタなので **getFeed の block/grade 引数を削除**して一本化。

### 6. コード品質（全採用。修正によるデメリットなしと判断済み）
- Q1: `npx supabase gen types typescript` の生成型へ移行し `as unknown as`（21箇所）を解消。
- Q2: from_sheet の扱い統一はタスク3に含めて解消。
- Q3: 「今日」の実装を JST 基準の共通 util（jstToday 等）1個に集約。`queries.ts:240,441` の `new Date().toISOString().slice(0,10)`（UTC）は**実バグ**（JST 0〜9時に前日の予定が今後の予定に残る）なので優先的に。
- Q4: MenuForm.tsx（958行）/ ScheduleSheetsManager.tsx（1015行）の分割（対象者ピッカー・プリセット・プレビュー表などの単位で）。
- Q5: getFeed / getUserActivity の FeedItem 組み立て重複（各約40行）を共通ヘルパーへ。

### 7. UI/UX（採用分）
- 記録フォームの日付に未来日を入力できないようにする（max 属性＋バリデーション。保存後に「消えた」ように見える問題の解消）。
- JST統一は 6-Q3 で解消。
- ホームの週間サマリー（走行距離・練習回数カード）は**中長距離ブロックの部員のみ表示**。他ブロックには表示しない（週間ランキングも従来どおり中長距離のみ）。
- Service Worker にオフラインフォールバック＋静的アセットキャッシュを追加（現状 push 専用で、オフラインだと開けない）。

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
- **全日付の行が最初から存在する**（行がある＝練習日ではない）。時間・場所・メニューのいずれかに中身がある行だけを予定として取り込む（この判定ルールは実データで要オーナー確認）。
- 取込は予定(practice_schedules)だけでなく、メニュー列から**ブロック全体メニュー(practice_menus)も同時に生成/更新**する（メニュー/ペース/補足/補強を本文に整形）。どのブロック向けかはシート登録時に指定。
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
