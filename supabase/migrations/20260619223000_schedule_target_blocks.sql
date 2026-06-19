ALTER TABLE practice_schedules
ADD COLUMN IF NOT EXISTS target_blocks TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE practice_schedules
DROP CONSTRAINT IF EXISTS practice_schedules_target_blocks_check;

ALTER TABLE practice_schedules
ADD CONSTRAINT practice_schedules_target_blocks_check
CHECK (
  target_blocks <@ ARRAY['middle_long', 'short', 'jump', 'throw']::TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_schedules_target_blocks
ON practice_schedules USING GIN (target_blocks);
