# 本人専用のPC試験版

本番のVercel・Supabase・Google OAuth・R2設定を変更せず、復元済みPCデータベースを使う別URLを用意した。これは本番の切替ではない。入力はPC内のコピーにだけ保存する。クラウドへ自動で戻さない。

## 現在の使い方

URLと専用パスワードはGit対象外の `.contingency/PC試験版ログイン.txt` に保存する。会話・Git・URLへパスワードを出さない。このファイルと `.contingency/private-trial.json` はWindowsの現在のユーザーとSYSTEMだけにアクセスを限定済み。

最初はPC内に新規作成した「PC試験ユーザー」で入る。一般部員の権限であり、システム権限は付けていない。本番ユーザーのパスワード・プロフィールは変更していない。本人の既存アカウントのコピーへ切り替える場合は本人のメールアドレスを確認してから行う。ログイン画面にGoogleパスワードを入力しない。

PCの電源・ネット接続を維持する。スリープ・終了・回線断ではアクセスできなくなる。自動起動やPCの電源設定は変更していない。Quick Tunnelは検証用で稼働保証がなく、プロセス再作成時にはURLが変わる。固定の本番URLとして扱わない。

## 構成と制限

- Windows版cloudflared 2026.8.3を `.contingency/bin` へ配置し、公式GitHub配布のSHA256と照合。
- トンネルが転送するのは `127.0.0.1:3108` の専用ゲートだけ。Next.jsは `127.0.0.1:3009`、Supabase APIは `127.0.0.1:8000`。DB/Studioを直接公開しない。
- ゲートがすべての画面・静的ファイル・APIを保護する。専用パスワードで特定のローカルアカウントにログインできた場合だけ、12時間のHttpOnly/Secure/SameSiteセッションを発行。パスワードは192ビットのランダム値。URLを知るだけではデータを読めない。
- REST等ではSupabaseにJWTを検証させ、設定されたユーザーIDと一致する場合だけ通す。認証APIは本人のセッション更新・ユーザー取得・ログアウトだけ。新規登録・外部OAuth・Auth管理APIは公開しない。
- 書き込みはOrigin一致を必須とする。ログイン試行は全体で15分間に8回まで。ログアウトとゲート再起動で専用セッションを無効化。
- スプシ/GAS・Google連携・Push・cron・旧アプリ連携はゲートで遮断。アプリプロセスにも該当秘密値を渡さない。Google暗号化キーも試験版には渡さない。
- R2は既存画像の読み取りだけ。アップロード/削除ガードを常時有効化。DBとFunctionsの外向き通信は既存rehearsal構成で隔離し、DB cronも停止したまま。
- リアルタイム配信とService Worker登録も停止。アプリ内の表示は必要に応じて更新する。画面上部に試験版の表示と専用ログアウトを追加。
- `NEXT_PUBLIC_PC_TRIAL=true` のときだけ専用ビルドと同一オリジンAPIを使う。クラウドや非loopback DBでこのフラグを有効にするとビルドを拒否する。通常本番の環境変数は変更しない。

## 停止と再開

```powershell
./ops/laptop/stop-private-trial.ps1
```

このコマンドは保存済みのPID・起動時刻・コマンドが一致する専用トンネル、ゲート、アプリだけを停止し、DBと試験データを残す。PC版Supabase自体の停止は従来の `runtime.ps1 stop` を別途使う。

トンネルを維持したアプリ/ゲートの再起動は次のとおり。再ビルドはアプリ停止中に行う。

```powershell
./ops/laptop/stop-private-trial.ps1 -Kind gateway
./ops/laptop/stop-private-trial.ps1 -Kind app
node ops/laptop/run-private-app.mjs build
./ops/laptop/start-private-process.ps1 app
./ops/laptop/start-private-process.ps1 gateway
```

トンネルまで停止した場合、新URLを取得して `.contingency/private-trial.json` のoriginとログイン案内ファイルのURLを更新してからゲートを再開する。パスワードをURLに付けない。既存の試験ユーザーを重複作成しない。

## 検証

- `node --test ops/laptop/private-gateway.test.mjs`: 未認証拒否、CSRF拒否、本人以外のJWT拒否、外部連携/Storage書き込み拒否、ログアウト、再起動での失効。
- HTTPS実接続: 専用ログイン、ホーム/タイムライン/ノート/マイページ200、本人REST、一般部員権限、目標の追加/編集/削除、セッション更新を確認。検証目標は回収。
- 全201テスト、対象eslint、TypeScript付きのPC専用本番ビルド成功。入口のブラウザ表示を確認。本人のスマホからの操作は未確認。

本番へ試験版をデプロイしない。今回の依頼は「本人だけの別URL」であるため、変更は専用ローカルブランチで保持する。本番masterとVercelは引き続き320be2e。
