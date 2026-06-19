# 予定のブロック対象化 ＋ メニュー機能 刷新（実装指示）

> 前提: `origin/master` が正・force-push禁止・作業前 pull。マイグレーションは新タイムスタンプ＆冪等。
> UI/操作は `docs/UI-UNIFICATION.md` の規約（書く=全画面/選ぶ=シート、編集削除=⋯）に従う。

## 0. ねらい
- 予定を**対象ブロックごと**に作成・表示する。
- メニューを **(a) ブロック共通メニュー**（短・跳・投）と **(b) 中長の対象者指定メニュー** に分け、
  本文と対象者を**構造化**して保存。対象者だけが見られる。

---

## 1. 予定（practice_schedules）に対象ブロック

### データ
- 追加カラム: `target_blocks TEXT[] NOT NULL DEFAULT '{}'`
  - `{}` = **全体**（全員に表示）
  - 例: `{middle_long}` / `{short,jump}` など（複数可）。

### 表示ロジック（getUpcomingSchedules / home / schedule）
- 一般部員には、`target_blocks = '{}'`（全体） **または** `target_blocks` と自分の `profile.blocks` が重なる予定だけ表示。
- **予定作成権限者（can_create_schedule）は全件表示**（管理のため）。
- セキュリティ上の秘匿ではなく“見やすさ”の出し分けなので、**アプリ側フィルタ**（queriesで）。RLS select は現状TRUEのまま。

### UI（予定作成/編集フォーム = 全画面）
- 「対象ブロック」を選択。**全体** をデフォルト。トグル/チップで複数選択（全体を選ぶと個別選択は無効化）。

---

## 2. メニュー刷新（practice_menus）

### 種類
- **(a) ブロック共通メニュー**：短距離・跳躍・投擲。1ブロック＝1メニューを想定。そのブロックの部員に表示。
- **(b) 対象者指定メニュー**：主に中長距離。本文＋対象者（複数選択）。**選ばれた人だけ**表示。
- 中長で「全員共通の連絡」を出したい場合に備え、(a) を中長にも使える形にしておく（任意）。

### データ
`practice_menus`（既存）に追加・整理:
- `schedule_id`（既存, FK）
- `author_id`（既存, FK）= 作成者（カードに表示）
- `content`（既存）= 本文（自由記述）
- `group_name` は廃止（使わない）。
- 追加 `target_block TEXT NULL` … (a)ブロック共通のときの対象ブロック（'middle_long'|'short'|'jump'|'throw'）。(b)のときは NULL。
- 追加 `status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published'))` … 下書き/公開。
- 追加 `updated_at`（既存あれば流用）。

新テーブル `practice_menu_targets`（(b)の対象者リスト）:
```
menu_id  UUID FK -> practice_menus(id) ON DELETE CASCADE
user_id  UUID FK -> profiles(id) ON DELETE CASCADE
PRIMARY KEY (menu_id, user_id)
```

新テーブル `menu_target_presets`（担当者のよく使う対象者プリセット）:
```
id        UUID PK
author_id UUID FK -> profiles(id) ON DELETE CASCADE
name      TEXT NOT NULL
user_ids  UUID[] NOT NULL DEFAULT '{}'
created_at TIMESTAMPTZ DEFAULT now()
```

### メニューの種別判定
- `practice_menu_targets` に行がある → **対象者指定メニュー(b)**。
- 行が無く `target_block` あり → **ブロック共通メニュー(a)**。
- （`target_block` も対象者も無い → 全体共通。基本は使わないが許容。）

### 表示（誰にどのメニューを見せるか）
ある予定のメニュー一覧を出すとき、viewer に見せる条件:
- 公開(`status='published'`) かつ次のいずれか:
  - 対象者(b): viewer がそのメニューの対象者に含まれる。
  - ブロック共通(a): `target_block` が viewer の `blocks` に含まれる。
  - 全体共通: 上記指定が無い。
- **作成者本人・メニュー作成権限者(can_create_menu)** には、**下書き含め**自分の管理対象が見える（編集のため）。

### RLS（できれば本物のアクセス制御で）
- `practice_menus` select を以下に: `status='published'` かつ（対象者に自分が含まれる OR target_block が自分のblocksに含まれる OR 指定なし） **OR** 作成権限者(`can_create_menu()`) **OR** 自分が作成者。
  - 対象者判定は `EXISTS (SELECT 1 FROM practice_menu_targets t WHERE t.menu_id = practice_menus.id AND t.user_id = auth.uid())`。
  - blocks判定は `target_block = ANY((SELECT blocks FROM profiles WHERE id = auth.uid()))`。
- insert/update/delete: `can_create_menu()` かつ `auth.uid() = author_id`（管理者は別途許可可）。
- `practice_menu_targets`: select は親メニューが見えるなら見える（簡易にTRUEでも可、内容は本文側で守られる）。insert/delete は can_create_menu。
- `menu_target_presets`: 全操作 `auth.uid() = author_id`。

---

## 3. UI（実装は Codex / 規約は UI-UNIFICATION.md）

### メニュー作成（全画面フォーム）
- まず種別を選ぶ: **「ブロック共通」** か **「対象者を指定」**。
- ブロック共通: 対象ブロックを選択（短/跳/投/中長）＋本文＋下書き/公開。
- 対象者指定: 本文＋**対象者を複数選択**。
  - **プリセット読み込み**（自分の保存済みから選ぶ）→ 反映後に**手動で増減**できる。
  - 選択中の対象者を**プリセットとして保存**するボタン（名前を付けて）。
- **本文と対象者は必ず別欄**。1欄に複数人分を書かない。

### 予定カード
- viewer に見えるメニューだけ表示（上記ロジック）。作成権限者には下書きも（バッジ「下書き」）。
- 各メニューに作成者名（`担当: ◯◯`）。編集/削除は `⋯`（UI規約）。

---

## 4. 要確認（実装前に決めたい点・暫定の既定値）
1. 予定/メニューとも**作成権限者は全ブロック分を閲覧・管理できる**でよい？（既定: はい）
2. 新規メニューの初期状態は **下書き** でよい？（既定: はい→公開で全員に出る）
3. 中長の「ブロック共通(a)」も使えるようにする？（既定: 使える）
4. 短/跳/投で「対象者指定(b)」も使えるようにする？（既定: 使えるが基本は共通(a)）
5. メニューの可視制御は **RLSで厳密** に守る？（既定: はい。難所だが対象者限定の要件があるため）
