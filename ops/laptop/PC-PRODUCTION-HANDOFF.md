# PC本番運用の引き継ぎ（2026-09-09）

2026-09-10更新: 所有者は旧クラウドの更新を後回しとし、9/17以降に別PCをサーバー化する予定。大会記録v2のmigration 20260909010000/20260910010000はPCのみ適用済み。旧クラウドへの試行は接続切断でロールバックされ、列なし・履歴0件・凍結維持を読み取り確認済み。元の復帰手順はスキーマ不一致のためそのまま実行できない。復帰準備の追加実装は依頼されていない。9/16 15:00の停止期限は変更していない。

**この文書が過去の「本番未変更」「本人限定試験」「承認待ち」の記録に優先する。** Claudeや別端末のCodexは最新origin/masterとこの文書を最初に読む。

## 本番と期間

- URL: **https://tuat-tf.vercel.app**。アプリはVercel、DB/AuthはこのWindows PCのWSL Ubuntu、画像は非公開R2。
- 運用期間: **2026-09-09 15:00〜2026-09-16 15:00 JST**。所有者が実ログイン成功を報告。こちらではログイン画面、Google/大学認証への遷移、Auth API 200を確認。全員の実機操作は未確認。
- Vercel `tuat-tf` / `prj_fLc2aGQHb2Ny4IMt21ESzN0ij25p`。初回PC本番デプロイ `dpl_EC7B7nTfWUBHVQFbTXgFsLFoEorS`。最新デプロイはVercelで確認する。
- 元のSupabase `snbgxocgdhqtuywrlqrs` は**アプリ/Auth identity書き込み凍結中、旧cron 2本も停止中**。PCが唯一の書き込み先。
- 最新クラウドから45対象テーブルを移し全行一致を検証。プロフィール65人、既存Auth/Google identityを保持。試験アカウントは削除済み。通常の大学Googleアカウントで再ログインする。
- `tuat-tf-pc-preview.vercel.app` と古いCloudflare試験URLは案内しない。本人限定の試験プロセスは終了。本番は通常の部員認証。

## 起動と接続

Windowsタスク **TUAT PC Backend Temporary** → `backend-task.ps1` → WSLのDockerと `run-backend.mjs` を起動する。所有者のWindowsログイン中に動作し、タスク終了時は1分間隔で再試行。中継心拍が150秒止まれば対象プロセスを再起動する。古い子プロセスの回収と親タスク終了検知を実装済み。

Vercel `/api/pc-supabase` → R2の署名付き・180秒有効の接続先 → Cloudflare Tunnel → `127.0.0.1:3109` の専用キー付きゲート → `127.0.0.1:8000` のSupabase API。JWT署名とRLSはSupabaseが検証する。DBやStudioを公開しない。

画面は消してよい。タスクが自動スリープを抑止するが、電源断・手動スリープ・サインアウト・再起動は停止要因。9月9日に蓋閉じのAC/DC設定が両方「何もしない」であることを確認した。電源につなぎ、放熱を妨げず運用する。蓋閉じ後の実機継続稼働は未確認。

このPCのリポジトリで使うコマンド:

```powershell
node ops/laptop/control-backend.mjs status
node ops/laptop/audit-backend.mjs
powershell -NoProfile -File ops/laptop/runtime.ps1 status
powershell -NoProfile -File ops/laptop/restart-backend.ps1
```

最後のコマンドだけ再起動を行う。タスクを一時無効化して競合を防ぎ、実行ファイルと親PIDを照合した当アプリの中継だけ停止する。DB/他アプリは保持。全Node終了、WSL全停止、Docker volume削除はしない。

ログは `.contingency/backend/` の `runtime-status.json`、`backup-status.json`、`task.log`、`task-error.log`、`task-restarts.jsonl`、`runtime-start-error.log`。状態確認スクリプトは秘密や部員データを表示しない。Auth 200まで確認し、プロセス生存だけで正常と扱わない。

Wi-Fi変更時は中継先を再取得してR2へ署名保存するため、利用者URLやGoogle設定の変更は不要。Quick Tunnelには稼働保証がなく、再接続中は通信できない。McAfeeの不要なVPN経路は解除後に疎通確認済み。ウイルス対策/Firewallは無効化していない。WSLはmirrored networking、DNS tunneling、firewall有効。Dockerのサブネットはテザリングとの重複を避けている。

## 秘密情報と保存先

- 本番機 `C:\Paimon Dayo\TUAT_TF`、WSL `Ubuntu`、`/opt/tuat-tf-supabase`、Docker project `tuat-contingency`。
- `.contingency/backend/config.json`: bridge/暗号鍵、期間、maintenance。**表示・Git追加禁止**。
- `.contingency/backend/google-oauth.env`: Google秘密鍵。**本番中に configure-backend-auth.mjs --preview を実行しない**。全員のcallbackが変わる。
- `.contingency/local-app.env`: PC側の独立キー。`.env.local` は元のクラウド設定のまま。これを使った開発をPC本番操作と取り違えない。
- Vercel Productionに承認済みPCサーバーキー/R2設定を保存済み。秘密鍵をNEXT_PUBLIC_に置かない。一般のPreviewへ本番秘密設定をコピーしない。
- `.contingency/backend/production-rollback-env.json`: 復帰用クラウド設定。データを戻す前に適用しない。
- WSL `/opt/tuat-tf-supabase/transfer/`: `cloud-frozen-final-20260909.jsonl`、PC移行前後のスナップショット、`cutover-applied.json` 等。生データはGitに含めない。

## バックアップと復帰

public/auth/storageを15分ごとにダンプし、AES-256-GCM暗号化後、所有者のR2 `tuat-tf-images` の `ops/pc-backend/a629d00c-159e-4b0e-8543-50b34dce9dba/backups/` へ保存。PUT/HEAD・サイズ・ハッシュを検証し、35分以上検証済みバックアップがなければ保護停止。起動直後もバックアップする。ダウンロード・復号・別DB復元を検証済み。

復号鍵はR2へ保存しない。config.jsonにあり、元のクラウドservice-roleキーから `SHA256("tuat-pc-backup-v1\0" + originalKey)` で再現可能。復旧前に元の鍵を破棄/無計画に更新しない。別端末への秘密情報の受け渡しは所有者の安全な経路で行い、チャット/Gitへ貼らない。

復帰は **[RETURN-TO-SUPABASE.md](RETURN-TO-SUPABASE.md)**。新規だけでなく編集/削除も戻す。基準行比較とFK整合、不一致時の全体ロールバックを別DBで検証済み。managed Supabaseへの最終逆移行は当日の検証が必要。期限後はPCゲートが保護停止し、古いクラウドへ自動接続しない。

Codexのこのタスクに9月16日14:30 JSTの復帰作業再開を登録（`tuat-pc-supabase`）。PC/アプリ/認証が利用できなければ自動作業を保証できないため、他エージェントも期限を把握する。

## 検証と残事項

- 209 Vitest、専用ゲート/暗号化2テスト、TypeScript、対象ESLint、PC設定Next build成功。本番でも匿名・偽造JWT・管理API・外部Origin・直接中継アクセスの拒否を検証。
- 日本語エラーにUTF-8を明示。バックアップ処理と中継心拍を分離し、同期的なACL操作に上限時間を設けた。
- 写真はR2。アプリ内通知は30秒ポーリング。Vercel cronへ記録同期（JST 0:00）と予定同期（毎時05分）を移行。初回の自動同期ログは別途確認する。
- **Web Push未移行**: 既存VAPID秘密鍵がこのPCにない。勝手な鍵の再生成は全部員の再購読を必要とするため行っていない。正規に鍵を回収してPC Functions/Webhook/外向き通信を設定するか、クラウド復帰後の元の経路を使う。過去の通知の一括再配信や無断の全部員テスト通知をしない。
- OS再起動/別Wi-Fiへの変更/蓋閉じ後/スマホ全機種の実動作は未確認。Quick TunnelとPC電源に依存し、無停止保証はない。

## 別端末からの作業

コード修正・テスト・レビューは最新masterで可能。DB/Auth/復帰/トンネル/秘密鍵変更はこの本番PCで状態を確認して進める。別PCの同名ディレクトリは本番データではない。別端末から本番PCを操作する仕組みは用意していない。

一時運用中にスキーマを変更すると基準差分転送が拒否される。両側の整合と復帰計画を先に見直し、比較ガードを削除して通さない。クラウドにdb pushしてPCへ反映済みと扱わない。複数エージェントでDB/環境変数/デプロイを同時変更しない。最新masterへ統合し、Vercel READYと本番URLを確認して引き継ぐ。
