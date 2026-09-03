-- The former 30-minute job may have stopped part-way through a chunk cycle.
-- Start the first daily run from the beginning so nobody is skipped on cutover.
INSERT INTO public.sheet_sync_state (sync_key, next_offset)
VALUES ('practice_records', 0)
ON CONFLICT (sync_key) DO UPDATE
SET
  next_offset = 0,
  cycle_started_at = NULL,
  updated_at = NOW();
