# 予定のスプレッドシート一括入力（実装指示）

> 前提: `origin/master` が正・force-push禁止・作業前 pull。マイグレーションは新タイムスタンプ＆冪等。
> UI/操作は `docs/UI-UNIFICATION.md` の規約に従う。

## 0. 方針（確定）
- **Supabase が正式データ**。スプレッドシートは**一括入力・編集用の作業台**。
- **リアルタイム同期しない**。アプリで「インポート」を押した時だけ Supabase に反映。
- **MVP はテンプレコピー＋公開URL(CSV)読込**（OAuth不要）。「アプリ→シート書き戻し(push)」と自動発行は**フェーズ2でGoogle Sheets/Drive API化**。設計はAPI化しやすい形にしておく。

## 1. 導線
- 「予定を作成」画面の先頭に `SegmentedControl`「**通常入力 / スプレッドシートから入力**」。
- 「スプレッドシートから入力」では、発行済みシートの **一覧 / 作成 / 編集 / 削除 / 開く / インポート** ができる。

## 2. データモデル

### `schedule_sheets`（発行済みシート管理）
```
id               UUID PK
author_id        UUID FK -> profiles(id)
target_year      INT  NOT NULL
target_month     INT  NOT NULL                 -- 1..12
kind             TEXT NOT NULL CHECK (kind IN ('practice','meet'))   -- 練習予定/記録会
target_block     TEXT NOT NULL DEFAULT 'all'
                 CHECK (target_block IN ('all','middle_long','short','jump','throw'))
sheet_url        TEXT NOT NULL                  -- 編集用URL（人が開く）
csv_url          TEXT NULL                      -- 公開CSV（ウェブ公開のCSVリンク。読込用）
last_imported_at TIMESTAMPTZ NULL
status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))
created_at       TIMESTAMPTZ DEFAULT now()
```
- 複数月・複数ブロックを管理できる。
- **同じ (target_year, target_month, kind, target_block) のシートが既にある場合は作成時に警告**（重複登録の確認ダイアログ）。

### `practice_schedules` に追加
- `source_sheet_id UUID NULL FK -> schedule_sheets(id) ON DELETE SET NULL`
  - シート由来の予定を識別し、インポート時のスコープ照合・将来のpushに使う。手動作成の予定は NULL。

### RLS
- `schedule_sheets`: 全操作 `can_create_schedule()`（作成者本人 or 管理者で絞ってもよい）。
- `practice_schedules` の既存RLSは維持（`source_sheet_id` 追加のみ）。

## 3. シートのテンプレート

### 練習予定シート（kind='practice'）
列: **日付 / 曜日 / 対象ブロック / 時間 / 場所 / 詳細**
- 月を指定して作成。**日付・曜日は自動入力**（テンプレ側の数式 or 発行時生成）。
- **場所**は練習場所管理(`venues`)から選べるよう、シート上は**プルダウン(データ入力規則)**にできると理想。
- **曜日ごとのデフォルト時間**を設定し時間列に自動入力。**手動修正も可**。

### 記録会シート（kind='meet'）
列: **日付 / 曜日 / 記録会名 / 場所 / エントリー開始日 / エントリー締切日 / 対象ブロック / 詳細**
- 練習予定とは別テンプレート。

> MVP ではユーザーがテンプレ(Googleスプレッドシート)をコピー→ウェブ公開→CSV URLをアプリに登録する。
> 月のグリッド(日付/曜日)自動化はテンプレ内の数式で実現（年月セルに連動）。具体の数式作成はCodex/運用側。

## 4. Supabase へのマッピング
- 練習予定: 日付→`schedule_date`(その年の月日), 時間→`meeting_time`, 場所→`venue_name`(venues一致なら access/fee/url も補完), 詳細→`note`, 対象ブロック→`target_blocks`, `schedule_type='practice'`。
- 記録会: 日付→`schedule_date`, 記録会名→`title`, 場所→`venue_name`, エントリー開始→`entry_start`, 締切→`entry_end`, 対象ブロック→`target_blocks`, 詳細→`note`, `schedule_type='meet'`。
- いずれも `source_sheet_id` を当該シートに設定。

## 5. インポート（確認画面必須）
1. シートの **csv_url を読み込み**（OAuth不要）。テンプレ列に従ってパース。
2. **即保存せず確認画面**を出す。表示する区分:
   - **追加予定** / **更新予定** / **削除候補** / **エラー行** / **スキップ行**。
3. **処理範囲は、そのシートの (対象年月・種類・対象ブロック) に一致するものだけ**。
   - 例: 中長距離シートをインポートしても、短距離/跳躍の予定には触れない。
   - 照合キー: 既存 `practice_schedules` のうち `source_sheet_id =` 当該シート、または (schedule_date が対象年月内 AND target_blocks がシートのブロックと一致 AND schedule_type=kind)。
   - シート行に対応する既存があれば**更新候補**、なければ**追加候補**。
   - 範囲内の既存予定でシートに無いもの → **削除候補（表示のみ。自動削除しない）**。
4. **ユーザーが確定した時だけ** `practice_schedules` に反映（追加・更新を適用）。`last_imported_at` を更新。
5. エラー行（日付不正・場所未登録など）は適用せず一覧表示。スキップ行（空行等）も表示。

## 6. Pull/Push 運用（pushはフェーズ2）
- 各シートに「**アプリの予定をシートに反映(push)**」ボタンを用意する設計にする。
  - Supabase の現在の予定を、そのシートの対象範囲に合わせてスプシへ書き出す。
  - **書き込みは Google Sheets API が必要**なので、MVPでは無効/準備中表示。csv読込(import)を先に完成させる。
- 運用フロー: シート編集 → アプリで「シートからインポート」→ 確認 → 反映。

## 7. 段階リリース
- **フェーズ1（今回）**: schedule_sheets 管理(CRUD)＋テンプレ案内＋csv_url読込＋確認画面＋追加/更新の適用（削除は候補表示のみ）。
- **フェーズ2**: Google Sheets/Drive API による自動発行・書き戻し(push)・場所プルダウンの自動設定。

## 8. 要確認（既定で進めてよい点）
1. シート操作権限は `can_create_schedule()`（予定作成権限者）でよい？（既定: はい）
2. 削除は当面**候補表示のみ・自動削除しない**でよい？（既定: はい）
3. 照合は上記キーでよい？（同一日に複数予定がある場合は全て更新候補として個別表示）（既定: はい）

## 9. 編集可能プレビュー（実装済み 2026-06-21）

- CSV/Googleスプレッドシートは列位置ではなくヘッダー名で読み取る。
- 取込前に全行を編集可能な表で表示する。
- 各行を`追加 / 更新 / エラー / スキップ / 未確認`に分類する。
- セル編集後は未確認状態となり、同じAPIで再検証する。
- 日付、時刻、対象年月、対象ブロック、名称、エントリー期間を行単位で検証する。
- 正常行だけを先にSupabaseへ反映できる。
- エラー行は画面に残し、修正して再検証・再取込できる。
- 削除候補は初回読込時だけ計算し、自動削除しない。
- 検証処理は`src/lib/schedule-import.ts`へ集約し、URL読込・CSV・画面編集で共通利用する。
