# Vercelアプリ + PCバックエンドの本人限定試験

## 2026-09-08 現在の到達点

- Vercel CLIでオーナーとしてログイン済み。チーム `paimondayos-projects` に専用プロジェクト `tuat-tf-pc-preview` を作成済み。
- **まだデプロイされていない。** 自動承認レビューが試験専用ブリッジキーのVercel送信を拒否し、宛先を明示したオーナーの承認待ち。承認前に他経路で送信しない。
- 最初の構成に含めたDB管理者キー/R2秘密キーのコピーもレビューで拒否されたため撤去済み。最終構成は新規生成した試験専用キーとPCのanon公開キーだけを使用し、管理者キー・R2キー・Google/GAS/Push秘密値はPCに残す。
- PC側ゲートはブリッジ対応版へ再起動済み。旧URLとパスワード、PCデータは維持。ゲート再起動により以前の入口セッションは失効した。
- 全206テスト、ゲート2テスト、対象eslint、TypeScript付きVercel想定build成功。PCで同じPreview設定を起動し、実際のHTTPSトンネル経由でログイン・4画面・本人限定API・目標追加/編集/削除・refresh・logout・外部連携拒否を確認。未使用種目にだけテスト目標を作り、回収済み。
- ローカル検証はHTTPの3010番へHTTPS Originを指定したリハーサル。Vercel環境のネイティブフォーム・画像・ブラウザ表示の確認はデプロイ後に必要。

## 通信の分担

ブラウザはVercelの `/_pc/login` で既存の試験用パスワードを入力する。VercelのProxyが秘密の接続ヘッダーを付け、PCゲートの `/_pc/bridge` へ転送する。PC側は本人のAuthログイン成功後にCookieを発行する。ページ/APIはPC内の入口セッションを毎回確認し、SSRとブラウザのDB要求は本人JWTと既存RLSで制限する。接続キーだけでデータを読み取ることはできない。

画像のGETは本人セッション付きでPCアプリの画像APIへ中継し、既存の権限確認・署名URL発行を使う。そのため試験中は画像閲覧のためにもローカルアプリ3009番が必要。通常の画面描画はVercelが担当する。同期・通知・画像変更・Realtimeは従来どおり停止。

ブリッジキーはサーバー限定で、ブラウザ用JSに含まれないことをビルド後に確認済み。キーの失効は `.contingency/private-trial.json` のbridgeKey再生成とゲート再起動で行う。値を会話・Gitへ出さない。

## 承認後の手順

1. `node ops/laptop/prepare-vercel-trial.mjs` で `.contingency/vercel-pc-preview` を更新する。Git管理対象/非無視のsrc/publicと必要な設定だけを複製。本番.envは読み込まず、生成するvercel.jsonはGit対象外・Windows本人/SYSTEM限定。Vercel用の環境変数はここに限定する。
2. `vercel deploy --cwd .contingency/vercel-pc-preview --project tuat-tf-pc-preview --scope paimondayos-projects --target preview --yes --no-wait` を実行する。`--prod`は使わない。別プロジェクトにしたため本番環境変数を継承しない。
3. Readyを確認し、Vercelの保護機能を維持して本人で開く。専用パスワードをURLやログに含めない。ネイティブフォームのOrigin、Cookie、SSR/ブラウザのDB取得、画像閲覧、目標CRUD、匿名拒否を実URLで検証する。
4. 完了時だけ新しいテストURLをログイン案内へ追記し、本番ではないことを明示する。PCがスリープすると使えず、Quick Tunnel再作成時はURL更新と再デプロイが必要。

## ローカルの検証再現

`node ops/laptop/build-vercel-trial.mjs` でPreview設定をローカルビルドする。現在のPC試験版とは別の `.next` を使う。`node ops/laptop/build-vercel-trial.mjs start` で127.0.0.1:3010を起動し、`node ops/laptop/verify-vercel-trial-local.mjs` で検証する。終了時は3010の検証プロセスだけを止め、既存の3009/3108/トンネルは残す。
