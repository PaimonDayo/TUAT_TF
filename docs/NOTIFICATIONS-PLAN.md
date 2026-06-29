# 通知機能 実装仕様（実装・本番投入済み）

## 2026-06-29 追加: ロール別通知とリアルタイム未読表示

- お知らせ投稿時の通知先を「全員」または複数ロールから選択できる。
- `notices.target_role_ids` が空配列なら全部員、値があれば該当ロールを1つ以上持つ承認済み部員へ通知する。
- 複数の対象ロールに所属する部員にも通知は1件だけ作成する。
- お知らせ自体の閲覧範囲は従来どおり全部員。ロール指定はアプリ内通知・Web Pushの送信先だけを制御する。
- `notifications` をSupabase Realtimeへ公開し、ヘッダー右上ベルの赤丸を新着・既読変更時に即時更新する。
- ロール権限に最上位の「システム管理」を追加。通常の投稿者は自己投稿通知を受け取らないが、システム管理権限者は動作確認・運用監視のため自分のお知らせも通知対象になる。
- システム管理権限の付与・解除、同権限を含むロールの割り当ては、既存のシステム管理者だけが実行できる。最後のシステム管理者は解除できない。

最終更新: 2026-06-22 / 起案: Claude Code / 実装: Antigravity（初版）→ Claude Code が列名バグ修正・予定通知廃止・Web Push基盤の本番投入を完了。

> このドキュメントは通知機能の「正」。現状の実装内容と一致させること。
> 不明点は**現状コードを読んで確認**し、古い台帳（UX-ISSUES / UI-AUDIT）の記述を根拠に作り直さないこと。

## 0. 守ること（このプロジェクト固有・重要）
- **編集/削除のUIは「⋯ ActionMenu」が現行標準。スワイプは未採用**（`AGENTS.md`索引の「スワイプ＋長押し」は古い記述）。通知の削除/既読もスワイプにしない。
- **通知の生成はクライアント直 INSERT 禁止**。他人宛の行を作るため、必ず **DBトリガー（SECURITY DEFINER）** で作る（偽通知防止）。クライアントには `notifications` の INSERT 権限を与えない。
- **update の無言失敗**に注意（`src/lib/safe-update.ts` を流用）。
- マイグレは**新しいタイムスタンプ＋冪等**（`IF NOT EXISTS` / `DROP POLICY IF EXISTS` / `CREATE OR REPLACE`）。
- 初期データ取得は `src/lib/queries.ts` に集約。操作系は Client Component。
- ガクつき禁止（未読バッジ・件数は `tabular-nums`＋固定幅）。
- コミット署名は **Antigravity 名**。着手前に `git pull`、push 前に `npx tsc --noEmit`＋`npm run build`。

## 1. 確定した仕様（ユーザー決定済み）
- **通知センターはベルに同居**：`/notices` を拡張し、上部 `SegmentedControl` で「お知らせ」/「あなたへ」を切替（X/GitHub型）。
- **通知種別は2つ＋ユーザーが受信ON/OFFを選べる**：
  - `comment` … 自分の投稿（練習記録・つぶやき）へのコメント
  - `notice` … お知らせの投稿
  - 既定は**全てON**。マイページに2種のトグル。OFFの種別は通知行を作らない＆Pushも送らない。
  - ~~`schedule_update`（予定の追加・変更）~~ … **廃止**（2026-06-21 ユーザー判断。一括取込での通知爆発も回避）。
    `20260622020000_remove_schedule_notifications.sql` でトリガー・関数・`notify_schedule` 列を削除済み。
- **Web Push を最初から実装**（OSネイティブ通知）。アプリ内通知＋赤バッジは全環境で動作、Pushは対応端末のみ（フォールバック）。

## 2. データベース

### 2-1. `notifications`（個人通知）
```sql
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, -- 受信者
  actor_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,         -- きっかけを作った人
  type           TEXT NOT NULL CHECK (type IN ('comment','schedule_update','notice')),
  reference_type TEXT CHECK (reference_type IN ('record','tweet','schedule','notice')),
  reference_id   UUID,            -- 紐づく投稿/予定/お知らせのID（遷移先）
  is_read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
```
RLS:
- SELECT/UPDATE/DELETE は**自分の通知のみ**（`user_id = auth.uid()`）。UPDATE は既読化、DELETE は本人削除用。
- **INSERT ポリシーは付けない**（生成はトリガーの SECURITY DEFINER 経由のみ）。

### 2-2. 受信設定（`profiles` に列追加）
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_comment  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_schedule BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_notice   BOOLEAN NOT NULL DEFAULT TRUE;
```

### 2-3. `push_subscriptions`（Web Push 購読・端末ごと複数可）
```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
-- 本人のみ INSERT/DELETE/SELECT（自分の購読の登録・解除）
```

### 2-4. 通知生成トリガー（SECURITY DEFINER）
- `comments` の INSERT 後：対象投稿（record/tweet）の所有者を引き、**所有者≠コメント者**かつ所有者の `notify_comment=TRUE` のとき `notifications` を1件作成。`actor_id=コメント者`, `reference_type=target_type`, `reference_id=target_id`。
- `practice_schedules` の INSERT/UPDATE 後：`notify_schedule=TRUE` の**全アクティブ部員**へ作成（`actor_id=created_by`、自分自身は除外）。UPDATE は主要項目（日付/時刻/場所/タイトル/note）が変わった時のみ。
  - ⚠️ 全員分INSERTになるので、`INSERT INTO ... SELECT` で一括作成しN+1を避ける。
- `notices` の INSERT 後：`notify_notice=TRUE` の全アクティブ部員へ作成（`actor_id=投稿者`、自分除外）。
- いずれも `SECURITY DEFINER`／`SET search_path = public`。関数は `CREATE OR REPLACE`、トリガーは `DROP TRIGGER IF EXISTS` 後に作成。

## 3. UI

### 3-1. ヘッダーのベル（`src/components/layout/Header.tsx`）
- 未読（`is_read=false`）が1件以上あるとき、ベル右上に**赤いドット**を表示（数字は出さない＝ガクつき回避。出すなら固定幅＋`tabular-nums`）。
- 未読数は Server 側で取得して prop で渡すか、軽いクライアント取得。`Header` を使う全画面で出るよう、取得箇所に注意（レイアウトの共通取得が望ましい）。

### 3-2. 通知センター（`/notices` 改修）
- ヘッダー直下に `SegmentedControl`：**「お知らせ」**（既存の notices 一覧）/**「あなたへ」**（`notifications` 一覧）。
- 「あなたへ」リスト項目：
  - 文言例 `{actor名}さんがあなたの練習記録にコメントしました` / `{actor名}さんが予定を更新しました` / `お知らせ「{タイトル}」が投稿されました`。
  - **タップで遷移＋既読化**：`reference_type/id` から該当画面へ（record/tweet→該当カード、schedule→予定、notice→`/notices#notice-<id>`）。同時に `is_read=true`（`safe-update` 流用）。
  - 未読は左に小さなドット等で表現（背景色は変えてよいが幅は固定）。
  - **「すべて既読」ボタン**を上部に。個別削除は **⋯ ActionMenu**（スワイプ禁止）。
- 取得は `src/lib/queries.ts` に `getNotifications(userId)` 等を追加。actor の表示名/アバターを join。

### 3-3. 通知設定（マイページ）
- 3種トグル（`notify_comment`/`notify_schedule`/`notify_notice`）。**既存の共通 `Toggle` 部品があれば再利用**（無ければ既存トグルに合わせる）。保存は `safe-update`。
- 併せて **Web Push の「通知を有効にする」** ボタンをここに置く（3-4）。

### 3-4. Web Push 有効化フロー（マイページ）
- ボタン押下→ `Notification.requestPermission()` → 許可されたら Service Worker を登録し `pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: VAPID公開鍵 })` → 得た購読を `push_subscriptions` に保存。
- 解除ボタンで購読解除＋該当行 DELETE。
- 状態（未許可/許可済み/ブロック中）を表示。ブロック中はブラウザ設定から、と案内。

## 4. Web Push 配信

### 4-1. Service Worker
- `public/sw.js`（または `app` で配信）に `push` イベントハンドラ：`self.registration.showNotification(title, { body, data:{ url } })`、`notificationclick` で `clients.openWindow(url)`。
- manifest は既存（`src/app/manifest.ts`, `display:standalone`）。アイコンは現状 `/icon.svg`。

### 4-2. 配信トリガー（推奨: Supabase Edge Function ＋ Database Webhook）
- `notifications` への **INSERT を Database Webhook** で Edge Function に飛ばす。
- Edge Function：受信した通知行の `user_id` の `push_subscriptions` を引き、`web-push`（VAPID）で配信。本文は type に応じて生成。`410/404` の購読は DELETE（失効処理）。
- これにより**通知の発生源に関係なく**（トリガー生成でも）必ず Push が飛ぶ。アプリ側コードに送信処理を散らさない。

### 4-3. ⚠️ iOS の制約（UIで案内）
- iOS の Web Push は **「ホーム画面に追加」した PWA・iOS 16.4+** のみ。タブのままでは届かない。
- マイページの有効化フロー付近に「iPhone は『ホーム画面に追加』してから有効化してください」の一文を出す。
- 非対応端末では**アプリ内通知＋赤バッジにフォールバック**（必ず動く）。

## 5. ユーザーの手作業（Antigravity は手順を提示、登録はユーザー）
- VAPID 鍵生成：`npx web-push generate-vapid-keys`
- env 設定：
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`（クライアント購読用・公開鍵）→ `.env.local` ＋ Vercel
  - `VAPID_PRIVATE_KEY` ＋ `VAPID_SUBJECT`(mailto:) → Edge Function のシークレット（`supabase secrets set`）
- Edge Function のデプロイ（`supabase functions deploy`）と Database Webhook（`notifications` INSERT → 関数）の作成。
- 上記はコミットに含めない（秘密鍵）。Antigravity は**手順書を出して登録依頼**する。

## 6. フェーズ（順に push 可能な単位で）
1. `notifications`＋RLS＋生成トリガー（comment→schedule→notice）、`queries.ts`、通知センター（タブ同居）、赤バッジ、タップ既読＋すべて既読＋⋯削除。
2. 受信設定3トグル（`profiles`列＋マイページUI）。トリガーは設定を見て生成。
3. PWA Service Worker＋`push_subscriptions`＋VAPID＋有効化フロー＋Edge Function配信＋iOS案内。

各フェーズ完了ごとに `docs/CLAUDE-HANDOFF.md`（または専用の引き継ぎ節）へ結果を記録し、`AGENTS.md` 作業ログに commit を追記すること。
