# 練習記録・メニューのスプレッドシート双方向同期（実装指示）

> 前提: `origin/master` が正・force-push禁止・作業前 pull。マイグレーションは新タイムスタンプ＆冪等。
> これは「予定の一括入力」(`SHEETS-IMPORT-PLAN.md`) とは**別機能**。あちらはアプリ独自フォーマットの新規スプシ。
> こちらは **既存の `D:\AI\Antigravity\TF` 構造のスプレッドシート**（部員別シート）との同期。

## 0. 方針（確定）

- **方式A: GASブリッジ**。TFの `gas/Code.gs` をWeb App公開し、アプリのサーバーからHTTPで叩く。OAuth不要。
- **対象データ: 練習記録（最優先）＋ 月別メニュー(フェーズ2)**。つぶやき・いいね・コメント(リプライ)は**アプリ限定**（同期しない）。
- **双方向。1時間ごとに pg_cron で同期**。競合は **last-writer-wins**（`updated_at <= synced_at`→スプシ優先で取込／それ以外→アプリ優先で書き戻し）。
- **見出し名ベースの統一マッピング**。GASは「`日付` を含む行」を見出し行として検出し（中長距離=1行目／短距離=2行目どちらも可）、**見出し名で生セルを読み書き**する（`fetchAllRaw` / `writeCells`）。アプリ側が「アプリ項目↔見出し名」を解決する。
  - 中長距離: `低強度/中強度/高強度/解糖系/流し/補強/結果/感想` をキーワード一致で数値・テキスト枠へ。
  - 短距離: `メニュー/目的・意識/タイム/補強/コメント` を既存フィールドへ、`起床T/就寝T/昼寝/睡眠T/考えたこと` 等の独自列は**カスタム項目**で対応。
- **対応できる構造**: 見出し行が1行目でない／週ごとの目標ブロックで空行・ヘッダー再出現／重複見出し（最初を採用）。**`日付` 見出しが全く無いシートは対象外**。

## 1. スプシ構造（TF と同一）

記録用スプレッドシート（`SPREADSHEET_ID`）:
- **部員ごとに1シート**。シート名は `B1〇〇` / `M2〇〇`（正規表現 `^[BM]\d`）。
- ヘッダー行は `低強度` を含む行で自動検出。列はヘッダー名で動的特定:
  `日付(A列固定) / 低強度 / 中強度 / 高強度 / 解糖系 / 流し / 補強 / 感想(コメント/反省/状態) / 結果(ペース) / 実際の距離(or 距離)`。
- 感想列より右の空ヘッダー列は「リプライ」（**今回は同期対象外**）。
- **月別メニュー**シート: `5月メニュー` 等。列 `日付 / 曜日 / 時間 / 場所 / メニュー / ペース / 備考`。

## 2. データマッピング（記録）

| スプシ列 | アプリ `practice_records` |
|---|---|
| 日付 | `recorded_date` (yyyy-MM-dd) |
| 低強度 | `dist_low` |
| 中強度 | `dist_mid` |
| 高強度 | `dist_high` |
| 解糖系 | `dist_speed` |
| 流し | `strides` |
| 補強 | `strength_text` |
| 感想 | `memo` |
| 結果 | `result_text` |
| （なし） | `condition` … **アプリ限定**（列が無いので同期しない） |
| （なし） | `menu_text` / `focus_text`（短距離系）… **アプリ限定**（標準TFシートに列が無い） |

- 部員の同定: `profiles.sheet_name`（プロフィール画面で選択）↔ シート名。`sheet_name` 未設定の部員は同期対象外。
- GAS `writePracticeRecord` payload: `{ memberName, date, jog, mlt, cv, speed, strides, reinforce, comment, result, total }`。
- GAS `fetchAll` 返却: `{ name, gid, records:[{date,total,jog,mlt,cv,speed,strides,reinforce,comment,result,replies}] }`。

## 3. データマッピング（メニュー）※フェーズ2の push を含む

| スプシ列(月別メニュー) | アプリ |
|---|---|
| 日付 | `practice_schedules.schedule_date`（`schedule_type='practice'`） |
| 時間 | `meeting_time` |
| 場所 | `venue_name` / `location` |
| メニュー(+ペース/備考) | `practice_menus.content`（`status='published'`, `target_block=NULL`=全体） |

- メニューは「日ごと1本（全体）」というスプシ構造のため、アプリのブロック別・対象者指定は表現できない（lossy）。
- さらに `practice_menus.author_id` が必須・既存予定との重複排除・RLS など本番リスクがあるため、**メニュー同期は丸ごとフェーズ2**に回す。
- GAS 側（`fetchPractice` pull / `writeMenu` push）はフェーズ2用に**準備済み**。

## 4. DB変更（マイグレーション）

```sql
ALTER TABLE profiles        ADD COLUMN IF NOT EXISTS sheet_name    TEXT;
ALTER TABLE profiles        ADD COLUMN IF NOT EXISTS record_fields JSONB DEFAULT '[]';  -- カスタム項目定義
ALTER TABLE practice_records ADD COLUMN IF NOT EXISTS custom        JSONB DEFAULT '{}';  -- カスタム項目の値
ALTER TABLE practice_records ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE practice_records ADD COLUMN IF NOT EXISTS synced_at     TIMESTAMPTZ;  -- 最後にシートと突合した時刻
-- updated_at 自動更新トリガー（同期書き込み時は updated_at=synced_at にして誤 push を防ぐ）
-- sheet_sync_runs ログ表（最終実行・件数・エラー。手動同期ボタンの結果表示用）
```

- `profiles.record_fields`: `[{key,label,type:'text'|'number',sheetColumn?}]`。`sheetColumn` を入れた項目だけスプシ同期。
- 記録フォームは「中長距離の数値枠 or 短距離の自由記述枠」＋ この**カスタム項目**を動的描画（`RecordForm`）。プロフィール編集で項目を追加・削除。

- `practice_records` に一意制約は**追加しない**（既存の重複リスク回避）。突合は同期コードで `user_id + recorded_date` をキーに手動マッチ。

## 5. GAS変更（`TF/gas/Code.gs`・ユーザーが再デプロイ）

- `SYNC_SECRET` 定数を追加。**書き込み系と新GET（listMembers/fetchAllRaw）**で `?secret=` / `postData.secret` を検証（空なら無検証＝開発用）。
  - 注意: 設定すると **secret を送らない旧TFアプリの投稿は弾かれる**（閲覧の fetchAll 等は従来どおり）。
- `findGenericHeaderIndex`: 「`日付`を含む行」を見出し行として検出（中長/短距離どちらも対応）。
- `fetchAllRaw`（GET）: 全 `[BM]\d` シートを `{name, gid, header[], records:[{date, cells:{見出し→値}}]}` で返す。マッピングはアプリ側。
- `writeCells`（POST）: `{memberName, date, cells:{見出し→値}}` を見出し名で upsert（無い見出しはスキップ＝列は勝手に増やさない）。
- `listMembers`（GET）: シート名一覧（プロフィールのプルダウン用）。
- `writeMenu`（POST・フェーズ2用に準備）。

## 6. アプリ側構成

- `src/lib/sheet-sync.ts`: スプシ⇔Supabaseのマッピング・突合（純TS、テスト可能）。
- `POST /api/sheets/sync`: `SHEET_SYNC_SECRET` 必須。記録の pull→突合→反映 と push、メニュー pull を実行。`sheet_sync_runs` に結果記録。
- `GET /api/sheets/members`: ログインユーザー向け。GAS `listMembers` を中継してプルダウン候補を返す。
- `ProfileEditForm`: 「スプレッドシートの自分のシート」プルダウン（候補は `/api/sheets/members`）。
- 管理者向け「今すぐ同期」ボタン（マイページ）→ `/api/sheets/sync` を起動し結果表示。

## 7. スケジューリング（pg_cron + pg_net）

`pg_cron` で1時間ごとに `pg_net.http_post` で `/api/sheets/sync` を叩き、`SHEET_SYNC_SECRET` を Authorization に付与する。
**URL・シークレットは Vault に入れる**ので、この SQL はリポジトリに秘密を残さない（マイグレーションには含めず、Supabase SQL Editor で一度だけ実行）。

```sql
-- 1) 拡張（未導入なら）
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) URL とシークレットを Vault に保存（値は自分のものに置き換え。再実行時は先に既存を削除）
select vault.create_secret('https://tuat-tf.vercel.app/api/sheets/sync', 'sheet_sync_url');
select vault.create_secret('<SHEET_SYNC_SECRET>', 'sheet_sync_secret');

-- 3) 毎時0分に実行
select cron.schedule(
  'sheet-sync-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sheet_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sheet_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 解除する場合: select cron.unschedule('sheet-sync-hourly');
```

## 8. 必要な環境変数

| 変数 | 場所 | 用途 |
|---|---|---|
| `SHEET_SYNC_GAS_URL` | Vercel | デプロイ済みGASの `/exec` URL |
| `SHEET_SYNC_SECRET`  | Vercel + GAS定数 + pg_cron | 同期APIとGASの共有シークレット |

## 9. デプロイ手順（ユーザー作業）

1. `TF/gas/Code.gs` を更新内容で**再デプロイ**（ウェブアプリ／自分として実行／全員アクセス可）。`SYNC_SECRET` を設定。
2. Vercel に `SHEET_SYNC_GAS_URL` `SHEET_SYNC_SECRET` を登録。
3. マイグレーション適用（`"Y" | npx --yes supabase db push`）。
4. 各部員がプロフィールで自分のシートを選択。
5. 管理者が「今すぐ同期」で動作確認 → 問題なければ §7 の SQL で pg_cron を登録。

## 10. 段階リリース

- **フェーズ1（今回）**: 記録の双方向同期＋プロフィール選択＋手動同期＋pg_cron。
- **フェーズ2**: メニュー同期（pull/push）、差分最適化（変更行のみ pull）、競合UIの可視化。
