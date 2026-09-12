# 陸上部ログ 🏃

陸上競技部向けの、練習記録・予定・ランキング共有アプリです。
Next.js 16 (App Router) + Supabase + Tailwind CSS v4 で作られています。

> **開発する人へ**: このファイルは**ゼロから自分の環境を立てる人向け**の手引き。
> 実際の開発ルール・現在の実装状況・本番構成は **`AGENTS.md`** を正とする。
> 本番（https://tuat-tf.vercel.app ）のDBは2026-09-09から所有者PCのWSL内Supabaseで動いていて、
> 下の手順で作る新しいクラウドプロジェクトとは別物。運用は `ops/laptop/` の各文書を見る。

---

## セットアップ手順（はじめての方向け）

プログラミングに詳しくなくても進められるよう、順番に説明します。
**①〜⑤ を上から順にやれば動きます。**

### ① Supabase プロジェクトを作る
1. https://supabase.com にアクセスし、GitHub か Google でサインアップ
2. 「New project」を押し、名前・パスワード（メモしておく）・リージョン（Tokyo 推奨）を設定して作成
3. 数分待つと使えるようになります

### ② データベースを作る（マイグレーションを流す）
`supabase/migrations/` に141個のマイグレーションが入っている。これを順に適用する。

```bash
npx supabase link --project-ref <プロジェクトID>
npx supabase db push
```

> 以前この手順は `supabase/schema.sql` を貼り付けるものだったが、**そのファイルはもう無い**。
> テーブル定義はマイグレーションの積み重ねが正になっている。

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
権限は `roles`（ロール定義）と `profile_roles`（誰がどのロールか）で決まる。
一度ログインしたあと、Supabase の SQL Editor で自分に管理ロールを付ける：

```sql
insert into public.profile_roles (profile_id, role_id)
select p.id, r.id
from public.profiles p, public.roles r
where p.email = 'あなた@st.大学.ac.jp' and r.can_manage_system
on conflict do nothing;
```

> 以前は `UPDATE profiles SET role = 'admin'` と案内していたが、**単一ロール方式はもう使っていない**。
> 2人目以降はアプリの「ロール管理」画面（マイページ→管理メニュー）から付けられる。

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

**ここには書かない。** 機能は日々増えていて、この欄は放置されると嘘になる
（実際、完成済みの「練習予定の作成UI」「メニュー入力フォーム」を長いあいだ未実装と書いたままだった）。

現在の実装状況は次を見る:
- `AGENTS.md` … 作業ログ（新しい順）と実装バックログ。**ここが正**
- `docs/CLAUDE-HANDOFF.md` … 直近の引き継ぎ
- `docs/ARCHITECTURE-REFACTOR-PLAN.md` … 分割の進み具合

## 技術メモ
- **Next.js 16** では旧 `middleware.ts` が **`proxy.ts`** に改称されています（本プロジェクトは `src/proxy.ts`）。
- `params` / `searchParams` / `cookies()` はすべて **非同期（await 必須）**です。
- Tailwind v4 のため、カラー等のデザイントークンは `src/app/globals.css` の `@theme` で定義しています。
- データ取得は Server Component（`src/lib/queries/` のドメイン別モジュール。入口は `@/lib/queries`）、
  投稿・いいね等の操作は Client Component で行います。
- 自分のIDだけで引ける取得は `getCurrentUserId()` を使い、プロフィール取得と**同時に**投げます
  （直列にするとDBへの往復が1回ぶん増える。`docs/UI-UNIFICATION.md` §4.5）。
- RLS の無限再帰を避けるため、権限判定は `is_admin()` / `is_staff()` / `can_*()` 関数経由にしています
  （定義は `supabase/migrations/` の各マイグレーション）。
- `next.config.ts` の `cacheComponents` と `experimental.staleTimes` は**有効化しないこと**
  （2026-07-12にiOS PWAの全面フリーズを起こした。理由は同ファイルのコメント）。
