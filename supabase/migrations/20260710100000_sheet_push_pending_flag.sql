-- タスク16: write-through(アプリ→スプシ即時反映)の失敗を追跡する専用フラグ。
-- 既存のupdated_at/synced_atの大小比較(appIsNewer)を'sheet'メイン部員の再送判定に流用すると、
-- write-through導入前からの無関係なタイムスタンプのズレ(過去の別要因)まで「再送対象」に
-- 誤検知し、部員がスプシへ直接入力した内容を古いアプリの値で上書きしかねないことが
-- dry-runで判明したため、専用列で明示的に管理する。
ALTER TABLE practice_records
  ADD COLUMN IF NOT EXISTS pending_sheet_push BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN practice_records.pending_sheet_push IS
  'write-through(保存直後のスプシ反映)が失敗し、次回の毎時同期での再送が必要な状態か。成功時はfalseに戻す。';
