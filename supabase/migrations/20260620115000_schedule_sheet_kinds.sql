ALTER TABLE schedule_sheets
DROP CONSTRAINT IF EXISTS schedule_sheets_kind_check;

ALTER TABLE schedule_sheets
ADD CONSTRAINT schedule_sheets_kind_check
CHECK (kind IN ('practice', 'meet', 'time_trial'));

ALTER TABLE schedule_sheets
DROP CONSTRAINT IF EXISTS schedule_sheets_month_check;

ALTER TABLE schedule_sheets
ADD CONSTRAINT schedule_sheets_month_check
CHECK (
  (kind = 'practice' AND target_year IS NOT NULL AND target_month BETWEEN 1 AND 12)
  OR (kind IN ('meet', 'time_trial') AND target_year IS NULL AND target_month IS NULL)
);

-- これまでUI上「記録会」と表示しながら meet で保存していたCSV取込分を補正。
UPDATE practice_schedules schedule
SET schedule_type = 'time_trial'
FROM schedule_sheets sheet
WHERE schedule.source_sheet_id = sheet.id
  AND sheet.kind = 'meet'
  AND schedule.schedule_type = 'meet';

UPDATE schedule_sheets
SET kind = 'time_trial'
WHERE kind = 'meet';
