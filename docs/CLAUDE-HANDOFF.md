# Claude Code 引き継ぎメモ

最終更新: 2026-06-20

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
