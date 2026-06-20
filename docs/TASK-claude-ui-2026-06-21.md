# Claude Code向け UI改善指示書（2026-06-21）

> 着手前に`AGENTS.md`、`docs/UI-UNIFICATION.md`、`docs/UX-ISSUES-2026-06.md`を読むこと。
> `origin/master`が正。force-push禁止。作業前に`git pull`。
> コミット前に`npx tsc --noEmit`、push直前に`npm run build`を通す。
> コミット末尾に`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`を付ける。

## 担当境界

Claude Codeは以下のUI・操作改善を担当する。

- つぶやきフォームのキーボード表示対策
- ホーム/タイムラインの投稿展開・折りたたみとレイアウト安定化
- ノート記事の枠内展開UI
- 予定/タイムライン/ノート上部のタイトル・タブ寸法統一

Codex側で別途扱うため、以下には手を出さない。

- お知らせのホーム取得ルール、前日リマインド判定
- お知らせリアクションのDB、RLS、取得・更新処理
- お知らせカードから一覧への遷移
- マイページの「自分のノート」導線削除
- Google Sheets/Drive、予定インポート

既に作業中の`AdminMemberList`、`GradeMenu`、`MemberDirectory`の変更は保持し、
本タスクとまとめる場合も内容を失わないこと。

---

## タスク1: つぶやきフォームのキーボード表示対策

### 現象

FABから「つぶやき」を選ぶと`Textarea`へ自動フォーカスされてキーボードが開き、
入力欄や投稿ボタンが表示領域外へ押し出されることがある。

関連:

- `src/components/post/TweetForm.tsx`
- `src/components/ui/fullscreen.tsx`
- `src/components/ui/form-modal.tsx`
- `src/components/layout/FAB.tsx`

### 方針

- 全画面フォームの外枠は常に`100dvh`相当へ収める。
- キーボード表示中もヘッダーと投稿操作を画面内に残す。
- スクロール領域だけを縮め、フォーム全体を画面外へ移動させない。
- iOS Safari/PWAで`visualViewport`が変化した場合も対応する。
- つぶやきだけの場当たり的な固定高さではなく、`FullScreenContent`側で再利用可能な形を優先する。
- 自動フォーカスを維持すると破綻する場合は、つぶやき作成時の`autoFocus`を外してよい。

### 受け入れ条件

- [ ] つぶやきを開いてキーボードが表示されても入力欄と投稿ボタンへ到達できる
- [ ] 閉じるボタンが画面外へ移動しない
- [ ] iOS Safari/PWAと通常ブラウザで全画面フォームの高さが破綻しない
- [ ] 予定・お知らせ等の既存FormModalも壊れない

---

## タスク2: ホーム/タイムラインの投稿展開を安定化

### 現象

- 簡易表示から詳細表示へ切り替えると、カード全体が内側へ寄るように動いて見える。
- padding、avatarサイズ、要素位置、カード幅などが同時に変化し「グラッ」とする。
- ホームは開けるが、展開後に同じ操作で閉じにくい。
- タイムラインの簡易表示設定はタブを離れて戻っても維持したい。

関連:

- `src/components/features/HomeFeed.tsx`
- `src/components/features/TimelineView.tsx`
- `src/components/cards/RecordCard.tsx`
- `src/components/cards/TweetCard.tsx`
- `src/components/cards/PostActions.tsx`

### 方針

- compact/詳細でカード外枠の横幅、左右padding、ヘッダー位置を変えない。
- 状態差は本文・詳細項目・アクション行の表示有無を中心にする。
- avatar、名前、メニュー位置が横に動かないよう固定する。
- 高さの開閉は許容するが、横方向の移動や一瞬の縮小・拡大は起こさない。
- 投稿カードを再マウントさせず、同じDOM位置で内容を開閉する。
- ホームはカード全体または明確な展開ボタンで開閉できるようにし、開いた後も閉じられるようにする。
- 詳細内のいいね、コメント、編集等の操作で誤って閉じないようイベント伝播を整理する。
- タイムラインの簡易表示設定は`localStorage`等で保持する。
- 初期描画時の設定復元で詳細表示が一瞬出てから簡易表示になるフラッシュを防ぐ。
- `prefers-reduced-motion`では開閉アニメーションを無効にする。

### 受け入れ条件

- [ ] compact/詳細切替でカードが横に動かない
- [ ] avatar、名前、カード左右端の位置が変わらない
- [ ] ホームの投稿を開いた後、同じ投稿を閉じられる
- [ ] 投稿内のいいね・コメント操作で意図せず閉じない
- [ ] タイムラインの簡易表示設定が別タブから戻っても維持される
- [ ] 設定復元時に詳細→簡易の表示フラッシュが起きない

---

## タスク3: ノート記事を枠内で展開

### 目的

ノートフォルダ内の記事を毎回別ページへ移動せず、コメント欄のように
選択した記事の枠が下へ広がって本文を読めるようにする。

関連:

- `src/app/(app)/notes/[id]/page.tsx`
- `src/app/(app)/notes/[id]/articles/[articleId]/page.tsx`
- `src/components/features/NoteArticleActions.tsx`
- `src/components/features/NoteArticleEditor.tsx`
- `src/components/cards/CommentSection.tsx`（開閉表現の参考）

### 方針

- 記事行を押すと、その記事カード内で本文・作者・更新日を展開する。
- もう一度押すと閉じる。
- 複数同時展開か1件のみ展開かは、既存の画面密度に合わせて判断してよい。初期値は全件閉じる。
- 本文は`Linkify`＋`whitespace-pre-wrap`。
- 長文はカード内で無制限に巨大化させず、一定量を超えた場合は
  「全文を表示」から既存記事詳細ページへ移動できるようにする。
- 編集・削除は展開内に表示してよいが、権限判定とRLSは現状を維持する。
- 展開操作と編集・削除・リンク操作が競合しないようにする。
- 開閉でカードの左右位置や幅を変えない。

### 受け入れ条件

- [ ] フォルダ内の記事をその場で開閉できる
- [ ] 展開後に本文、作者、更新日を確認できる
- [ ] URLを押しても記事が意図せず閉じない
- [ ] 長文は「全文を表示」から記事詳細へ移動できる
- [ ] 編集・削除権限と既存の記事詳細ページが壊れない

---

## タスク4: 予定/タイムライン/ノートの上部寸法を統一

### 現象

下ナビで予定、タイムライン、ノートを切り替えた際、タイトル直下の
セグメント・フィルタ行の高さ、上余白、位置が異なり、画面が上下に揺れて見える。

関連:

- `src/app/(app)/schedule/page.tsx`
- `src/components/features/ScheduleView.tsx`
- `src/app/(app)/timeline/page.tsx`
- `src/components/features/TimelineView.tsx`
- `src/app/(app)/notes/page.tsx`
- `src/components/features/NotesView.tsx`
- `src/components/ui/segmented.tsx`
- `src/components/layout/Header.tsx`

### 方針

- 予定のページタイトルを「練習予定」から**「予定」**へ変更する。
- 3ページでHeader直下の開始位置、上余白、フィルタ/タブ行の高さを揃える。
- `SegmentedControl`自体の高さを安定させ、項目数や文字数で縦寸法を変えない。
- タイムラインの追加フィルタアイコンを含む行も、予定/ノートのタブ行と同じ基準高さにする。
- タブ切替時にタイトルやタブが数px上下しないよう、固定寸法・`min-height`を使う。
- 各ページ固有の機能は削らない。

### 受け入れ条件

- [ ] 予定ページのタイトルが「予定」になっている
- [ ] 予定/タイムライン/ノートでタイトル下のタブ開始位置が揃っている
- [ ] タブ/フィルタ行の高さが揃っている
- [ ] 下ナビで連続切替しても上下方向に揺れて見えない
- [ ] 320px程度の狭い画面でも文字や操作が重ならない

---

## 検証と報告

1. `npx tsc --noEmit`
2. 変更ファイルのESLint
3. `npm run build`
4. 可能ならiPhone相当の幅（390x844）と狭幅（320px程度）で確認
5. `docs/CLAUDE-HANDOFF.md`へ以下を追記
   - 変更点
   - コミットハッシュ
   - 実機未確認事項
6. 機能ごとに小さく日本語コミットし、`origin/master`へpush
