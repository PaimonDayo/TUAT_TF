# Claude Code 引き継ぎメモ

最終更新: 2026-06-21

## ノートの記事リスト化（タスク2）

- 実装コミット: `ff708c1` ノートをフォルダと記事の形式へ刷新
- `docs/NOTES-PLAN.md` をフォルダ＋記事形式へ全面改訂。
- データ構造:
  - 既存の `notes` をノートフォルダとして利用。
  - `note_articles` を追加し、フォルダ内に複数の記事を保存。
  - 既存 `notes.body` は同じタイトルの最初の記事へ自動移行。
  - 本番データは3フォルダ・3記事へ移行されたことを確認済み。
  - `note_themes` は旧データ互換のため残すが、新UIでは使用しない。
- 画面:
  - `/notes`: 共有/個人のフォルダ一覧。記事数と作者を表示。
  - `/notes/[id]`: フォルダ情報と記事一覧。
  - `/notes/[id]/articles/[articleId]`: 記事本文の表示・編集・削除。
  - フォルダ内FABは、権限確認後にそのフォルダの記事作成を直接開く。
  - ホームと部員詳細のノート表示もフォルダ名＋記事数へ更新。
- 権限:
  - 共有/個人の両方で `全員 / 指定者 / 作者のみ` を設定可能。
  - 記事のSELECT/INSERT/UPDATE/DELETEは親フォルダの
    `can_view_note` / `can_edit_note` をRLSで継承。
  - フォルダ設定とフォルダ削除は作者または管理者のみUI表示。
  - 匿名ユーザーの `can_edit_note` が `false` になることを確認済み。
- 適用済みマイグレーション:
  - `20260621120000_note_articles.sql`
  - `20260621121000_secure_note_edit_access.sql`
  - `supabase migration list` でLocal/Remote一致を確認済み。

確認済み:

- `npx tsc --noEmit`
- ノート関連変更ファイルのESLint
- `npm run build`
- 本番DBの移行件数確認
- 匿名編集判定の拒否確認

実機で確認すること:

1. 共有・個人フォルダを作成し、複数記事を追加できる。
2. 記事を編集・削除して一覧へ正しく戻る。
3. 個人フォルダを「全員」または「指定者」にして、別ユーザーが記事を操作できる。
4. 作者以外にはフォルダ設定・フォルダ削除が表示されない。
5. 下書きフォルダが権限のないユーザーには表示されない。

## 文脈FABの実機手直し（タスク1.1）

- 実装コミット: `67e7934` FABの実機不具合を修正
- `/notes` の共有フォルダ一覧上部に「フォルダを作成」を追加。
  - 既存の `FolderForm` を全画面 `FormModal` で開く。
  - 保存後はモーダルを閉じて `router.refresh()` で一覧を更新する。
  - 空状態とノートエディタ内の案内文も新しい導線に合わせた。
- Speed Dial:
  - コンテナを最大15remのレスポンシブ固定幅にした。
  - 3項目を `w-full` にして等幅化し、`whitespace-nowrap` は維持。
- 予定/お知らせ/ノートのFAB:
  - `scale(0.92) -> scale(1)` のアイコンアニメーションを削除。
  - タブ切替時に位置・サイズが動かず、即時にアイコンだけ差し替わる。

確認済み:

- `npx tsc --noEmit`
- `npx eslint src/components/layout/FAB.tsx src/components/features/NotesView.tsx src/components/features/NoteEditor.tsx`

実機で確認すること:

1. 共有フォルダ一覧からフォルダを作成し、保存直後に一覧へ表示される。
2. Speed Dialの3項目が狭い端末でも同じ幅かつ1行で表示される。
3. 予定・お知らせ・ノートへ切り替えた際、FABアイコンが拡大・移動しない。

## 文脈FAB（タスク1）

- 実装コミット: `e889516` 文脈に応じたFABへ刷新
- ホーム/タイムライン:
  - FABはアクセント色の `＋`。
  - タップで「練習記録 / つぶやき / 大会・記録会の結果」の3行Speed Dialを表示。
  - 各項目は1行・内容幅・絶対配置で、通常レイアウトを押し広げない。
  - 展開中だけ `＋` を45度回転して閉じる表示にする。背景タップでも閉じる。
- 予定:
  - 権限保持者には `CalendarPlus` のFABを表示し、種別選択なしで予定フォームを開く。
- お知らせ:
  - 権限保持者には `BellPlus` のFABを表示し、種別選択なしでお知らせフォームを開く。
- ノート:
  - 共有フォルダ選択を `?folder=<id>` と同期。
  - フォルダ内では `NotebookPen` のFABを表示し、そのフォルダを初期選択したノート作成フォームを開く。
  - 「フォルダ未設定」は実体フォルダではないためFABを表示しない。
- 画面遷移:
  - FAB本体をpathname＋queryのキーで再マウントし、Speed Dialとフォーム状態を確実にリセット。
  - マイページ等の既存 `?compose=1` 導線は維持し、閉じると `router.back()` で元画面へ戻る。
- アニメーション:
  - 直接作成タブは色を変えず、アイコンの短いscale差し替えのみ。
  - `prefers-reduced-motion` では差し替えアニメーションを無効化。

確認済み:

- `npx tsc --noEmit`
- 今回変更箇所のlintエラーなし
- 全体 `npm run lint` は既存の `src/components/features/TimelineView.tsx:44`
  (`react-hooks/set-state-in-effect`) 1件のみ失敗。Claude担当範囲のため未変更。

実機で確認すること:

1. ホーム/タイムラインのSpeed Dialが狭い端末でも折り返さない。
2. 予定/お知らせ/ノートのFABが直接フォームを開く。
3. ノート作成フォームのフォルダ初期値が、開いていた共有フォルダと一致する。
4. Speed Dialを開いたまま下タブを切り替えると閉じた状態へ戻る。

## Google Drive / Sheets 連携

- Google Drive OAuth と予定シート自動発行を実装済み。
- 関連コミット:
  - `2401065` Google Drive連携と予定シート自動発行を追加
  - `927b81e` Drive連携時の再ログイン導線を修正
  - `0322834` シート発行に曜日別の時間と場所設定を追加
- Supabase マイグレーション
  - `supabase/migrations/20260620121000_google_drive_connections.sql`
  - 本番DBへ適用済み。
- OAuthトークンは `google_drive_connections` に暗号化して保存する。
- OAuthスコープは `openid email drive.file`。アプリが作成したファイルだけを扱う。
- 作成したスプレッドシートは、連携した利用者本人のマイドライブへ入る。
- OAuth開始は `/api/google/connect` への明示的なPOSTだけで行う。GETは予定画面へ戻す。
  ブラウザの履歴復元やURL直開きで認可画面へ飛ばないための対策。

## Google Cloud 構成

- 既存のGoogleログイン用プロジェクトとDrive連携用プロジェクトを分離した。
- Drive連携専用プロジェクト:
  - Project ID: `tuat-track-drive-2026`
  - Google Drive API: 有効
  - Google Sheets API: 有効
- OAuthクライアントのリダイレクトURI:
  - `http://localhost:3000/api/google/callback`
  - `https://tuat-tf.vercel.app/api/google/callback`
- OAuth JSONはリポジトリに含めない。
- ローカルでは `.env.local` の `GOOGLE_DRIVE_OAUTH_CREDENTIALS_PATH` からJSONを読む。
- Vercel Productionには次を設定済み:
  - `GOOGLE_DRIVE_CLIENT_ID`
  - `GOOGLE_DRIVE_CLIENT_SECRET`
  - `GOOGLE_DRIVE_REDIRECT_URI`
  - `SUPABASE_SERVICE_ROLE_KEY`
- 新プロジェクトへの切り替え後、本番を再デプロイ済み。

## 連携確認

- 大学アカウント `s253013u@st.go.tuat.ac.jp` の接続レコードが本番Supabaseに保存されることを確認済み。
- 途中でOAuthコールバックが `supabaseKey is required` になったが、Vercel Productionの
  `SUPABASE_SERVICE_ROLE_KEY` を再設定して解消した。
- 本番URL: `https://tuat-tf.vercel.app`

## 曜日別の時間・場所設定

練習予定の新規シート発行時に「曜日ごとの時間・場所」を設定できる。

- 設定欄は発行セクション内の `Disclosure`。通常は閉じている。
- 初期値:
  - 月曜 `17:00`
  - 水曜 `17:00`
  - 土曜 `09:00`
- 日曜から土曜まで個別に設定可能。
- 時間だけ、場所だけ、両方、どれも未設定、すべて対応。
- 場所は `venues` の登録内容から選択する。
- 空欄の項目は発行したシートでも空欄になる。
- 既存予定を編集用シートとして発行する場合は、既存予定の値を優先し曜日設定は使わない。
- APIは曜日 `0..6`、時刻 `HH:mm`、場所名の長さを検証する。

主な変更箇所:

- `src/components/features/ScheduleSheetsManager.tsx`
- `src/app/api/google/sheets/create/route.ts`
- `src/lib/google-drive.ts`
- `src/types/index.ts`

## 検証状況

`0322834` の変更について以下は成功済み。

- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- GitHub `origin/master` へpush済み
- Vercel Productionのデプロイが `Ready` であることを確認済み

## 次に確認すること

実端末で新規練習シートを1枚発行し、次を確認する。

1. 月曜と水曜に `17:00`、土曜に `09:00` が入る。
2. 選択した曜日の場所が該当日へ入る。
3. 時間だけ・場所だけの設定がそれぞれ反映される。
4. 発行したシートを編集後、プレビューとインポートが通る。

問題が出た場合は、Vercelの `/api/google/sheets/create` のログと、Google Sheets APIの
レスポンスを最初に確認する。
