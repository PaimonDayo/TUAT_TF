# テスト環境の使い方

本番とは分離した Supabase と Vercel を使い、Playwright が一時ユーザーを作成してログイン後の画面を検証します。

## 接続先

- アプリ: https://tuat-tf-staging.vercel.app
- Supabase: `TUAT-TF Staging`（project ref: `lvvybahbjmuipggynwog`）
- 本番への誤操作防止: テストコードは本番 URL と本番 Supabase project ref を明示的に拒否します。

ステージングの Google OAuth は設定していません。自動テストはステージング Supabase にだけメール・パスワード式の一時ユーザーを作り、ブラウザーのログイン状態を生成します。アプリ本体にテスト用ログインや認証迂回は追加していません。

## 普段の実行

初回だけ依存関係とブラウザーを準備します。

```powershell
npm install
npx playwright install chromium
```

`.env.e2e.local` は設定済みです。別の端末では `.env.e2e.example` をコピーし、ステージング用の値だけを設定してください。サービスロールキーを含むため、`.env.e2e.local` は Git に登録しません。

```powershell
# 単体テスト
npm test

# ステージングに対するログイン後E2Eテスト
npm run test:e2e

# ブラウザーを表示して実行
npm run test:e2e:headed

# Playwrightの操作画面から個別に実行・確認
npm run test:e2e:ui
```

E2E の開始時に一般メンバーとシステムロールの一時ユーザーを作り、終了時に削除します。現在は次を確認します。

1. 一般メンバーがホームからタイムラインへ移動できる
2. 中長距離ブロックでも「その他」から 400m を選べる
3. システムロールだけがブログを閲覧できる

テストを強制終了して一時ユーザーが残った場合は、次で削除できます。

```powershell
npm run test:e2e:cleanup
```

## ステージングへの反映

この作業フォルダーの `.vercel/project.json` は `tuat-tf-staging` に接続済みです。アプリの変更をステージングへ反映するには次を実行します。

```powershell
npx vercel deploy --prod --yes
```

これは独立した Vercel のステージングプロジェクトへ反映します。GitHub の `master` への push は従来どおり本番デプロイを起動するため、用途を混同しないでください。

DB マイグレーションを追加した場合は、Supabase CLI のリンク先をステージングに切り替えて `supabase db push` を実行し、作業後に必ず本番 project ref へ戻します。現時点のローカルリンクは本番に戻してあります。

## GitHub Actions

`.github/workflows/staging-e2e.yml` は手動実行用です。Repository Settings の Actions secrets に以下を登録すると、Actions の「Staging E2E」から実行できます。

- `E2E_BASE_URL`
- `E2E_EXPECTED_SUPABASE_REF`
- `E2E_SUPABASE_URL`
- `E2E_SUPABASE_ANON_KEY`
- `E2E_SUPABASE_SERVICE_ROLE_KEY`

サービスロールキーは秘密情報です。ログ、Issue、PR、コミットへ貼り付けないでください。
