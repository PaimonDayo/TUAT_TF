# ノート機能: フォルダ＋記事形式

> `origin/master` が正。force-push禁止。マイグレーションは新タイムスタンプかつ冪等。
> UIは「書く＝全画面FormModal」「選ぶ＝シート」に従う。

## 1. 目的

- ノートをタイムラインとは別の、継続して参照する知識・考えの置き場にする。
- 1つの長い本文を更新し続けず、ノートフォルダの中へ記事を追加していく。
- 共有ノートと個人ノートのどちらでも、設定に応じて共同編集できる。

## 2. 用語と構造

- `notes`: ノートフォルダ。名前、共有/個人、公開状態、共同編集権限を持つ。
- `note_articles`: フォルダ内の記事。タイトル、本文、作成者、作成日時、更新日時を持つ。
- `note_editors`: フォルダの指定編集者。
- `note_themes`: 旧共有分類。既存データ互換のためDBには残すが、新UIでは使用しない。

既存の`notes.title`はフォルダ名として引き継ぐ。既存の`notes.body`は移行時に
同じタイトルの最初の記事へ変換する。移行後の新規フォルダでは`body`は空文字とする。

## 3. データモデル

### `notes`（フォルダ）

```text
id          UUID PK
author_id   UUID FK -> profiles(id)
scope       shared | personal
theme_id    UUID NULL（旧データ互換）
title       TEXT NOT NULL
body        TEXT NOT NULL DEFAULT ''（旧データ互換）
status      draft | published
edit_policy everyone | specified | author
created_at  TIMESTAMPTZ
updated_at  TIMESTAMPTZ
```

- `personal`でも`edit_policy`を選択できる。
- `theme_id`は新規作成時はNULL。
- 公開状態はフォルダ単位。下書きフォルダの記事は閲覧権限者だけが見られる。

### `note_articles`

```text
id         UUID PK
note_id    UUID FK -> notes(id) ON DELETE CASCADE
author_id  UUID FK -> profiles(id) ON DELETE RESTRICT
title      TEXT NOT NULL
body       TEXT NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

## 4. 権限とRLS

### フォルダ閲覧

- `status='published'`
- フォルダ作者
- 管理者
- `edit_policy='everyone'`
- `edit_policy='specified'`かつ`note_editors`に登録済み

### フォルダ編集・記事作成編集削除

- フォルダ作者
- 管理者
- `edit_policy='everyone'`
- `edit_policy='specified'`かつ指定編集者

記事の全操作は`can_view_note(note_id)` / `can_edit_note(note_id)`を通じて
親フォルダの権限を継承する。UIガードだけにしない。

`note_editors`の変更はフォルダ作者または管理者だけが行える。

## 5. 画面

### `/notes`

- `共有 / 個人`の切替。
- 各行はノートフォルダ名、記事数、作者、公開状態を表示。
- フォルダ作成は一覧上部のボタンから全画面フォームを開く。
- 共有/個人、公開状態、共同編集権限を設定する。

### `/notes/[id]`

- フォルダ名と説明情報、記事一覧を表示。
- 記事行はタイトル、作成者、更新日を表示。
- FABでこのフォルダへ記事を直接作成する。
- フォルダ作者・管理者はフォルダ設定の編集と削除ができる。

### `/notes/[id]/articles/[articleId]`

- 記事本文を`Linkify`＋`whitespace-pre-wrap`で表示。
- 編集権限者は記事を編集・削除できる。
- 閉じる・戻る操作は元のフォルダへ戻る。

### 部員詳細

- その人が作成した公開個人ノートフォルダを表示する。

## 6. 記事エディタ

- タイトル
- 本文
- 保存中は二重送信を防止
- 作成者は記事作成時のユーザーとして記録

フォルダの共有設定は記事ごとに重複して持たず、フォルダ設定を継承する。

## 7. 今回対象外

- コメント
- いいね、人気順
- 画像・ファイル添付
- ブックマーク
