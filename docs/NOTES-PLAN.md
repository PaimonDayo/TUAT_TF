# ノート機能（実装指示）

> 前提: `origin/master` が正・force-push禁止・作業前 pull。マイグレーションは新タイムスタンプ＆冪等。
> UI/操作は `docs/UI-UNIFICATION.md` の規約（書く=全画面FormModal／選ぶ=シート／編集削除=⋯ActionMenu／共通部品EmptyState等）に従う。

## 0. ねらい
- 投稿・タイムラインのように**流れて消える**ものではなく、**テーマごと・個人ごとに残る知識/考えの蓄積**。
- **タイムラインには流さない**（投稿とは完全に別扱い）。
- まずは**コメント・いいね・人気順・画像添付なし**。最低限 **下書き/公開** を持つ。

## 1. 種類
- **共有ノート(shared)**: テーマ別に記事を蓄積（例: 怪我予防・中長距離・短距離・補強・大会準備・新入生向け）。部全体の知見。
- **個人ノート(personal)**: 各ユーザーが自分の考え・目標・意識していること等を残す。プロフィールに「〇〇のノート」として表示。

作成時にまず **共有/個人** を選ぶ。

## 2. データモデル

### `note_themes`（共有ノートのテーマ）
```
id          UUID PK
name        TEXT NOT NULL
description TEXT NULL
sort        INT NOT NULL DEFAULT 0
created_by  UUID FK -> profiles(id)
created_at  TIMESTAMPTZ DEFAULT now()
```
- **誰でも作成可**。**削除・編集（管理）は管理者(is_admin)のみ**。

### `notes`
```
id          UUID PK
author_id   UUID FK -> profiles(id) ON DELETE CASCADE
scope       TEXT NOT NULL CHECK (scope IN ('shared','personal'))
theme_id    UUID NULL FK -> note_themes(id) ON DELETE SET NULL   -- shared のみ。personal は NULL
title       TEXT NOT NULL
body        TEXT NOT NULL                                         -- 自由記述
status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published'))
edit_policy TEXT NOT NULL DEFAULT 'author' CHECK (edit_policy IN ('everyone','specified','author'))
created_at  TIMESTAMPTZ DEFAULT now()
updated_at  TIMESTAMPTZ DEFAULT now()
```
- `edit_policy` は**共有ノートの記事ごとの編集権限**。作成時に選ぶ:
  - `everyone` 全員が編集可 / `specified` 指定者のみ編集可 / `author` 作者のみ編集可。
- **個人ノート(personal)は常に作者のみ編集**（`edit_policy` は 'author' を強制）。

### `note_editors`（edit_policy='specified' の編集許可者）
```
note_id UUID FK -> notes(id) ON DELETE CASCADE
user_id UUID FK -> profiles(id) ON DELETE CASCADE
PRIMARY KEY (note_id, user_id)
```

## 3. 可視性 / RLS（最終的な守りはRLSで）
- `note_themes`: select TRUE。insert は認証済みなら可。update/delete は `is_admin()`。
- `notes` select:
  - `status='published'`（共有/個人とも公開は全部員に見える） **OR** 自分が作者 **OR** 編集可能者（下記）**OR** `is_admin()`。
  - ※下書きは作者・指定編集者・管理者にだけ見える。
- `notes` insert: `auth.uid() = author_id`。
- `notes` update:
  - 作者 **OR** `is_admin()` **OR**（`scope='shared'` かつ `edit_policy='everyone'`）**OR**（`edit_policy='specified'` かつ `EXISTS note_editors(note_id, auth.uid())`）。
  - `scope='personal'` は作者のみ（everyone/specified を無視）。
- `notes` delete: 作者 **OR** `is_admin()`。
- `note_editors`: 親ノートの作者・管理者が管理。select は親が見えるなら可（簡易TRUEでも可）。

## 4. 画面 / 導線

### 下ナビ変更（重要）
- 「ランキング」を「ノート」に置き換える。**並び順: ホーム / 予定 / タイムライン / ノート / マイページ**。
- **ランキングは削除しない**。ホームの機能一覧・マイページの一覧から遷移できるようにする（`/ranking` ページは維持）。

### `/notes`（ノートタブ）
- 上部に `SegmentedControl`「共有 / 個人」。
- **共有**: テーマ一覧（`note_themes`、記事数バッジ）。テーマを開く→そのテーマの公開記事一覧。`＋`でテーマ追加（誰でも）／記事追加。
- **個人**: 最近更新された**公開**個人ノートの軽い索引（部員ごと or 更新順。いいね/人気順なし、流れるフィードにしない）。
- `＋`（新規ノート）→ 全画面エディタ（§5）。

### プロフィールページ（部員詳細）
- **「〇〇のノート」セクション**を追加。その人の**公開**個人ノート一覧を表示（タップで閲覧）。

### マイページ
- **「自分のノート」**への導線を追加 → 自分のノート（共有/個人とも自分が作者のもの）を作成・編集・削除、下書き/公開の切替。
- ランキングへの導線もここ（または機能一覧）に置く。

## 5. エディタ（書く=全画面 FormModal）
- 種別: **共有 / 個人** を選択（SegmentedControl）。
- 共有のとき: **テーマ選択**（既存から or 新規作成）＋ **編集権限**（全員/指定者/作者のみ）。`specified` のときは対象者を複数選択（メンバー選択UIは `MenuForm` の対象者選択を流用）。
- 個人のとき: テーマ・編集権限は出さない（作者のみ）。
- 共通: **タイトル**＋**本文(自由記述・Textarea・Linkify対応で表示)**＋**下書き/公開**。
- 一覧/閲覧での編集・削除は `⋯`(ActionMenu)。本文表示は `whitespace-pre-wrap` ＋ `Linkify`。

## 6. やらないこと（今回スコープ外）
- コメント・いいね・人気順・画像添付。
- **ブックマークはフェーズ2**（別途）。設計上、後から `note_bookmarks(user_id, note_id)` を足せる形にしておく。

## 7. 今回ついでのUI微修正（`docs/UI-UNIFICATION.md` §3 にも追記）
- ホームの「こんにちは 〇〇さん」挨拶を**削除**。
- マイページのリンク順を整理（推奨順: 自分のノート → 目標 → 大会・記録会の結果 → メンバー一覧 → ランキング）。実装時に違和感あれば調整可。
