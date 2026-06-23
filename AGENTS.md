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

## 衝突防止：固定の担当領域は設けない（柔軟運用）＋必ず報告する
どのAIも領域を限定しない（柔軟に動けるように）。代わりに**「何を触るか／何をしたか」を必ず下の作業ログに報告**して可視化で事故を防ぐ。
- **作業は1体ずつ。`git pull`→作業→検証→push まで終えてから次のエージェントに渡す**（push 前の中途半端な状態で別の体に着手させない）。
- 着手したら**着手前に必ず `git pull`**（受け渡し直後でも省略しない）。
- **着手前**：下の「作業ログ」に1行追加（日付・エージェント名・これから触る範囲）。
- **完了後**：同じ行に結果（commit ハッシュ・要点）を追記。大きな変更は `docs/CLAUDE-HANDOFF.md` に詳細を書く。
- 他AIが直前に触った範囲は、ログを見て**現状コードを確認してから**触る（古い前提で上書きしない）。

## 作業ログ（着手前に追記・新しいものを上へ）
<!-- 形式: YYYY-MM-DD / エージェント / 触る範囲 → 結果(commit・要点) -->
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
