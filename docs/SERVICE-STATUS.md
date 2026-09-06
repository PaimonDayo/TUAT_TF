# システム管理者のサービス状態画面

マイページ → 設定 → システム管理 → サービスの状態（`/admin/services`）。ページとAPIの両方で `manage_system` を検証。APIは `getUser()` で認証し、一般部員プレビュー中も403。認証・ロール確認にSupabaseを使用するため、Supabase停止・利用制限中はアプリ内確認もできない場合がある。

## 表示するもの

- Vercel / Supabase / Cloudflare の公式Statuspage JSON APIから全体の障害状態と進行中の障害。個別プロジェクトの稼働保証にはしない。
- R2の設定バケットをS3 ListObjectsV2で全ページ集計した現在のバイト数・ファイル数。8GB（変更可）はアプリの保存停止目安。アカウント全体や月平均の課金使用量ではない。100ページ/8秒を超える場合は部分合計を表示せず取得失敗とする。
- R2の読み込み・書き込み・保存停止フラグ。接続可能と移行完了を混同しない。
- 任意設定の `VERCEL_MONITORING_TOKEN` と `SERVICE_STATUS_VERCEL_TEAM_ID` で公式 `GET /v1/billing/charges` を取得。UTC暦月のチーム全体、Usage行のConsumedQuantityをサービス名と単位別に合計。請求周期・プラン上限・最終請求額とは一致しないので無料枠残量を計算しない。
- Supabase月間Egress、R2月間操作数、各社の契約・無料枠残量は未取得と明示し、対象アカウントの公式使用量画面へリンクする。非公開のDashboard APIは使わない。

管理画面を開いたときだけ読み込み、15分間Next Data Cacheで結果を共有する。`cacheComponents` は有効にしない。再確認ボタンもキャッシュを強制破棄しない。取得日時を表示し、タイムアウトや未設定を0として表示しない。APIレスポンスはprivate/no-store、資格情報や生の請求レコードは含まない。ブラウザから外部管理APIにアクセスしない。

## 接続の準備

R2容量表示は画像移行用のバケット限定キーを共用する。2026-09-06にユーザー承認後、R2キーの発行・本番環境設定・実接続検証を完了。Vercel使用量キーは任意・サーバー環境変数にだけ保存する（こちらのキー発行・設定は未実施）。未設定でも障害情報と公式への導線は使える。トークン発行前に権限・対象チーム・有効期限を確認し、Vercelの本番環境にだけ設定する。

公式資料:
- https://vercel.com/docs/rest-api/billing/list-focus-billing-charges
- https://supabase.com/docs/guides/platform/manage-your-usage/egress
- https://developers.cloudflare.com/r2/platform/metrics-analytics/
