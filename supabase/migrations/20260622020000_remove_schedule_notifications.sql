-- 予定（schedule_update）通知を廃止（ユーザー判断: 予定追加の通知は不要・お知らせのみ）
-- コメント通知とお知らせ通知は残す。
-- 一括取込での通知爆発リスクも併せて解消される。

-- 予定トリガーと関数を削除
DROP TRIGGER IF EXISTS on_schedule_changed ON practice_schedules;
DROP FUNCTION IF EXISTS handle_schedule_notification();

-- 受信設定の予定トグル列を削除（未使用化）
ALTER TABLE profiles DROP COLUMN IF EXISTS notify_schedule;

-- type / reference_type の許可値から schedule 系を除外（クリーンアップ）
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('comment','notice'));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_reference_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_reference_type_check
  CHECK (reference_type IN ('record','tweet','notice'));
