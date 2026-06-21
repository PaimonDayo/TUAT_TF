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
- 2026-06-22 / Claude Code / Web Push基盤を本番投入: VAPID secrets登録/Edge Function send-web-push デプロイ/Vercel env(公開鍵)/pg_netで通知INSERT→push のwebhookトリガー。本番DBへ全マイグレ適用済み（バグ修正含む＝コメント/お知らせ投稿の不具合解消） → (このcommit)
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
