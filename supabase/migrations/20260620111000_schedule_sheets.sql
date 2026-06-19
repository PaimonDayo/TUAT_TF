CREATE TABLE IF NOT EXISTS schedule_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_year INT NOT NULL,
  target_month INT NOT NULL,
  kind TEXT NOT NULL,
  target_block TEXT NOT NULL DEFAULT 'all',
  sheet_url TEXT NOT NULL,
  csv_url TEXT,
  last_imported_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE schedule_sheets DROP CONSTRAINT IF EXISTS schedule_sheets_month_check;
ALTER TABLE schedule_sheets ADD CONSTRAINT schedule_sheets_month_check
CHECK (target_month BETWEEN 1 AND 12);

ALTER TABLE schedule_sheets DROP CONSTRAINT IF EXISTS schedule_sheets_kind_check;
ALTER TABLE schedule_sheets ADD CONSTRAINT schedule_sheets_kind_check
CHECK (kind IN ('practice', 'meet'));

ALTER TABLE schedule_sheets DROP CONSTRAINT IF EXISTS schedule_sheets_block_check;
ALTER TABLE schedule_sheets ADD CONSTRAINT schedule_sheets_block_check
CHECK (target_block IN ('all', 'middle_long', 'short', 'jump', 'throw'));

ALTER TABLE schedule_sheets DROP CONSTRAINT IF EXISTS schedule_sheets_status_check;
ALTER TABLE schedule_sheets ADD CONSTRAINT schedule_sheets_status_check
CHECK (status IN ('active', 'archived'));

CREATE INDEX IF NOT EXISTS idx_schedule_sheets_scope
ON schedule_sheets(target_year, target_month, kind, target_block);

ALTER TABLE practice_schedules
ADD COLUMN IF NOT EXISTS source_sheet_id UUID REFERENCES schedule_sheets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_practice_schedules_source_sheet
ON practice_schedules(source_sheet_id);

ALTER TABLE schedule_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedule_sheets_select" ON schedule_sheets;
DROP POLICY IF EXISTS "schedule_sheets_insert" ON schedule_sheets;
DROP POLICY IF EXISTS "schedule_sheets_update" ON schedule_sheets;
DROP POLICY IF EXISTS "schedule_sheets_delete" ON schedule_sheets;

CREATE POLICY "schedule_sheets_select"
ON schedule_sheets FOR SELECT
USING (public.can_create_schedule());

CREATE POLICY "schedule_sheets_insert"
ON schedule_sheets FOR INSERT
WITH CHECK (public.can_create_schedule() AND auth.uid() = author_id);

CREATE POLICY "schedule_sheets_update"
ON schedule_sheets FOR UPDATE
USING (public.can_create_schedule())
WITH CHECK (public.can_create_schedule());

CREATE POLICY "schedule_sheets_delete"
ON schedule_sheets FOR DELETE
USING (public.can_create_schedule());

CREATE OR REPLACE FUNCTION public.apply_schedule_sheet_import(
  target_sheet_id UUID,
  import_rows JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_sheet schedule_sheets%ROWTYPE;
  item JSONB;
  target_id UUID;
  expected_blocks TEXT[];
BEGIN
  IF NOT public.can_create_schedule() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT * INTO target_sheet
  FROM schedule_sheets
  WHERE id = target_sheet_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sheet not found';
  END IF;

  expected_blocks := CASE
    WHEN target_sheet.target_block = 'all' THEN '{}'::TEXT[]
    ELSE ARRAY[target_sheet.target_block]
  END;

  FOR item IN SELECT value FROM jsonb_array_elements(import_rows)
  LOOP
    target_id := NULLIF(item->>'id', '')::UUID;

    IF target_id IS NULL THEN
      INSERT INTO practice_schedules (
        schedule_date,
        schedule_type,
        meeting_time,
        venue_name,
        venue_access,
        venue_fee,
        venue_url,
        title,
        entry_start,
        entry_end,
        note,
        target_blocks,
        source_sheet_id,
        created_by
      ) VALUES (
        (item->>'schedule_date')::DATE,
        target_sheet.kind,
        NULLIF(item->>'meeting_time', '')::TIME,
        NULLIF(item->>'venue_name', ''),
        NULLIF(item->>'venue_access', ''),
        NULLIF(item->>'venue_fee', ''),
        NULLIF(item->>'venue_url', ''),
        NULLIF(item->>'title', ''),
        NULLIF(item->>'entry_start', '')::DATE,
        NULLIF(item->>'entry_end', '')::DATE,
        NULLIF(item->>'note', ''),
        expected_blocks,
        target_sheet.id,
        auth.uid()
      );
    ELSE
      UPDATE practice_schedules
      SET
        schedule_date = (item->>'schedule_date')::DATE,
        schedule_type = target_sheet.kind,
        meeting_time = NULLIF(item->>'meeting_time', '')::TIME,
        venue_name = NULLIF(item->>'venue_name', ''),
        venue_access = NULLIF(item->>'venue_access', ''),
        venue_fee = NULLIF(item->>'venue_fee', ''),
        venue_url = NULLIF(item->>'venue_url', ''),
        title = NULLIF(item->>'title', ''),
        entry_start = NULLIF(item->>'entry_start', '')::DATE,
        entry_end = NULLIF(item->>'entry_end', '')::DATE,
        note = NULLIF(item->>'note', ''),
        target_blocks = expected_blocks,
        source_sheet_id = target_sheet.id
      WHERE id = target_id
        AND (
          source_sheet_id = target_sheet.id
          OR (
            EXTRACT(YEAR FROM schedule_date) = target_sheet.target_year
            AND EXTRACT(MONTH FROM schedule_date) = target_sheet.target_month
            AND schedule_type = target_sheet.kind
            AND COALESCE(target_blocks, '{}'::TEXT[]) = expected_blocks
          )
        );

      IF NOT FOUND THEN
        RAISE EXCEPTION 'schedule % is outside import scope', target_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE schedule_sheets
  SET last_imported_at = NOW()
  WHERE id = target_sheet.id;
END;
$$;
