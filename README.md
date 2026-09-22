# TUAT T&F

陸上競技部向けの練習記録・予定・出欠・大会結果・ノート共有アプリ。Next.js 16 / React 19 / Supabase / Tailwind CSS v4 を使用する。

本番は [tuat-tf.vercel.app](https://tuat-tf.vercel.app)。アプリはVercel、DB/Authは所有者PCのWSL内Supabase、画像は非公開R2。旧クラウドSupabaseへ接続先だけを戻してはいけない。

開発ルールと完了条件は [AGENTS.md](AGENTS.md)、運用は [PC本番運用](ops/laptop/PC-PRODUCTION-HANDOFF.md)、文書全体は [文書案内](docs/README.md) を参照する。

## 開発環境

ルートディレクトリが現行アプリ。新アプリの `tuat-tf-next/` は別packageで、現行アプリのビルド・lint・テスト対象から除外している。

1. Node.js 22.12以降（この変更は24系で検証）を用意する。
2. `npm ci` でロックファイルに合わせて依存を導入する。
3. [.env.example](.env.example) を参照して、開発先に対応した `.env.local` を用意する。Supabase、Googleログイン、画像、通知、同期の設定は別々で、最初の4変数だけで全機能が動く構成ではない。秘密値はGitやログへ出さない。
4. `npm run dev` を実行し、`http://localhost:3000` を開く。

独立した検証DBを新規構築する場合、スキーマは `supabase/migrations/` の履歴を基に準備する。既存のCLIリンクや `.env.local` が現在の本番DBを指すとは限らない。DB変更は対象接続先・バックアップ・dry-run・適用履歴を確認してから行う。現在のPC本番に対する手順を、新規クラウドプロジェクト向けコマンドで代用しない。

GoogleログインにはAuthプロバイダーとコールバック設定が必要。権限は `roles` と `profile_roles` の複数ロール方式で、アプリのロール管理とDBのRLSにより制御する。

## 確認コマンド

| コマンド | 用途 |
| --- | --- |
| `npm run dev` | ローカル開発 |
| `npm test` | 現行アプリのVitest |
| `npx tsc --noEmit` | 型検査 |
| `npx eslint <変更ファイル>` | 変更箇所のlint |
| `npm run lint` | リポジトリのlint（既存の指摘も含む） |
| `npm run build` | 現在の環境設定でビルド |
| `npm start` | ビルドしたアプリを起動 |

所有者PCでの本番設定ビルドは `node ops/laptop/build-production-local.mjs`。非公開設定が必要なので、他のPCで同名フォルダを作って代用しない。

## 本番反映

既存のVercelプロジェクト `tuat-tf` はmasterの更新でデプロイされる。検証後にmasterへ統合・pushし、対象SHAのProductionがREADYになったことと、本番 `/api/version` がそのSHAを返すことを確認する。Previewの成功だけでは本番反映完了ではない。東京リージョン `hnd1` を維持する。

一般Previewへ本番のDB/管理キーを複製しない。デプロイ・DB・環境変数の同時変更を複数担当で行わない。

## 実装の要点

- 初期取得はServer Componentから `@/lib/queries` を呼ぶ。実体は `src/lib/queries/` の機能別モジュール。
- 互いに依存しない取得は並列化する。自分のIDだけで引けるデータはプロフィール取得を待たない。
- ホームは見出しと共通スケルトンを先に出し、本文を一括表示する。外部シートのメニューは予定を開いたときに取得する。
- 軽い操作はローカルstateで即時反映し、保存後の整合はサーバーの取得結果と合わせる。
- `cacheComponents` と `experimental.staleTimes` は再導入しない。過去のiOS PWAフリーズの経緯はAGENTSと `next.config.ts` のコメントを参照する。
- UI・文言の詳細は [UI統一](docs/UI-UNIFICATION.md) と [文言規約](docs/WORDING-GUIDELINES.md) に集約する。
