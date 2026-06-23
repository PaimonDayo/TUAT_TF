-- スプレッドシート(TF構造)との練習記録・メニュー双方向同期の土台
-- 詳細: docs/SHEETS-SYNC-PLAN.md
-- 冪等: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS

-- ── 1. プロフィールに「スプシの自分のシート名」(例: B2駒井) ──────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sheet_name TEXT;

-- 記録フォームのカスタム項目定義（短距離など独自列の人向け）。
-- 形式: [{ "key": "...", "label": "起床T", "type": "text"|"number", "sheetColumn": "起床T" }]
-- sheetColumn を入れると、その見出し名でスプシと同期する。
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS record_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 練習記録のカスタム項目の値。形式: { "<key>": "値" }
ALTER TABLE practice_records
  ADD COLUMN IF NOT EXISTS custom JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 2. 練習記録に更新時刻・同期時刻 ─────────────────────────────────────────
-- updated_at: アプリ側の最終更新（last-writer-wins の判定に使う）
-- synced_at : 最後にシートと突合した時刻（差分判定・ループ防止に使う）
ALTER TABLE practice_records
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS synced_at  TIMESTAMPTZ;

-- updated_at の自動更新。
-- ただし同期処理の書き込み（synced_at を更新する書き込み＝取込/書き戻し）は
-- 「アプリ側の編集」ではないので updated_at を synced_at に合わせる。
-- これにより updated_at <= synced_at が保たれ、取り込んだ行を誤って push し返さない。
-- それ以外（通常のアプリ編集）は updated_at = NOW()。
CREATE OR REPLACE FUNCTION public.touch_practice_record_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.synced_at IS DISTINCT FROM OLD.synced_at THEN
    NEW.updated_at = NEW.synced_at;
  ELSE
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_practice_records_updated_at ON practice_records;
CREATE TRIGGER trg_practice_records_updated_at
  BEFORE UPDATE ON practice_records
  FOR EACH ROW EXECUTE FUNCTION public.touch_practice_record_updated_at();

-- 突合キー (user_id, recorded_date) の検索を速く（UNIQUE制約は付けない＝既存重複の事故回避）
CREATE INDEX IF NOT EXISTS idx_records_user_date ON practice_records(user_id, recorded_date);

-- ── 3. 同期実行ログ（最終実行・件数・エラー。手動同期ボタンの結果表示用）──────
CREATE TABLE IF NOT EXISTS sheet_sync_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger       TEXT NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual')),
  triggered_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  pulled_count  INT NOT NULL DEFAULT 0,
  pushed_count  INT NOT NULL DEFAULT 0,
  menu_count    INT NOT NULL DEFAULT 0,
  error_text    TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sheet_sync_runs_started ON sheet_sync_runs(started_at DESC);

ALTER TABLE sheet_sync_runs ENABLE ROW LEVEL SECURITY;

-- ログは認証ユーザーなら閲覧可（書き込みは service role の同期処理のみ＝RLS外）
DROP POLICY IF EXISTS sheet_sync_runs_select ON sheet_sync_runs;
CREATE POLICY sheet_sync_runs_select ON sheet_sync_runs
  FOR SELECT USING (auth.uid() IS NOT NULL);
