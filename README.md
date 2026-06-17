# 陸上部ログ 🏃

陸上競技部向けの、練習記録・予定・ランキング共有アプリです。
Next.js 16 (App Router) + Supabase + Tailwind CSS v4 で作られています。

---

## セットアップ手順（はじめての方向け）

プログラミングに詳しくなくても進められるよう、順番に説明します。
**①〜⑤ を上から順にやれば動きます。**

### ① Supabase プロジェクトを作る
1. https://supabase.com にアクセスし、GitHub か Google でサインアップ
2. 「New project」を押し、名前・パスワード（メモしておく）・リージョン（Tokyo 推奨）を設定して作成
3. 数分待つと使えるようになります

### ② データベースを作る（SQL を貼って実行するだけ）
1. Supabase 左メニュー → **SQL Editor**
2. このリポジトリの `supabase/schema.sql` の中身を**全部コピー**して貼り付け
3. 右下の **Run** を押す → テーブルとセキュリティ設定が一括で作られます

### ③ 鍵（キー）を取得して .env.local に貼る
1. Supabase 左メニュー → **Project Settings → API**
2. 次の3つをコピーして、プロジェクト直下の `.env.local` に貼り付けます：

```
NEXT_PUBLIC_SUPABASE_URL=（Project URL）
NEXT_PUBLIC_SUPABASE_ANON_KEY=（anon public キー）
SUPABASE_SERVICE_ROLE_KEY=（service_role キー：人に見せない）
NEXT_PUBLIC_UNIVERSITY_DOMAIN=st.あなたの大学.ac.jp
```

> `NEXT_PUBLIC_UNIVERSITY_DOMAIN` には、部員の大学メールのドメイン（@ の右側）を入れます。
> ここに入れたドメインのアカウントだけがログインできます。

### ④ Google ログインを有効にする
1. Supabase 左メニュー → **Authentication → Sign In / Providers → Google** を ON
2. Google 側の設定（OAuth クライアント）が必要です：
   - https://console.cloud.google.com → 「APIとサービス → 認証情報」
   - 「OAuth クライアント ID」を作成（種類: ウェブアプリケーション）
   - **承認済みリダイレクト URI** に Supabase の画面に表示される
     `https://xxxx.supabase.co/auth/v1/callback` を登録
   - 発行された **クライアント ID / シークレット**を Supabase の Google 設定に貼る
3. Supabase の **Authentication → URL Configuration** で
   - Site URL に `http://localhost:3000`（開発時）／本番は Vercel の URL
   - Redirect URLs に `http://localhost:3000/auth/callback` を追加

### ⑤ 起動する
```bash
npm install      # 初回のみ
npm run dev
```
ブラウザで http://localhost:3000 を開く → Google でログイン

### ⑥ 自分を管理者にする（初回だけ）
一度ログインしたあと、Supabase の SQL Editor で次を実行（メールは自分のもの）：
```sql
UPDATE profiles SET role = 'admin' WHERE email = 'あなた@st.大学.ac.jp';
```

---

## 開発コマンド
| コマンド | 内容 |
|----------|------|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm start` | 本番サーバー起動 |
| `npm run lint` | Lint チェック |

## デプロイ（Vercel）
1. このリポジトリを GitHub に push
2. https://vercel.com で Import
3. 環境変数（`.env.local` の4つ）を Vercel のプロジェクト設定に登録
4. Deploy。完了後、その URL を Supabase の Site URL / Redirect URLs にも追加

---

## 実装状況
- **Phase 1（完了）**: 認証・プロフィール初回設定・ホーム・練習記録投稿・タイムライン・いいね/コメント・ランキング・マイページ（週間グラフ）
- **Phase 2（一部完了）**: 練習予定の閲覧（展開式・メニュー表示）・お知らせ（管理者投稿）・他部員プロフィール・PB管理・管理者のロール変更
- **未実装（今後）**: 練習予定の作成 UI（担当者）・メニュー入力フォーム（`MenuForm`）

## 技術メモ
- **Next.js 16** では旧 `middleware.ts` が **`proxy.ts`** に改称されています（本プロジェクトは `src/proxy.ts`）。
- `params` / `searchParams` / `cookies()` はすべて **非同期（await 必須）**です。
- Tailwind v4 のため、カラー等のデザイントークンは `src/app/globals.css` の `@theme` で定義しています。
- データ取得は Server Component（`src/lib/queries.ts`）、投稿・いいね等の操作は Client Component で行います。
- RLS の無限再帰を避けるため、role 判定は `is_admin()` / `is_staff()` 関数経由にしています（`supabase/schema.sql`）。
