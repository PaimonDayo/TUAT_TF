-- タスク14: 同期の運用堅牢化（2026-07-04 オーナー確定）。
-- 部分失敗の詳細を記録できるようにする。
ALTER TABLE sheet_sync_runs
ADD COLUMN IF NOT EXISTS failed_members JSONB NOT NULL DEFAULT '[]';
