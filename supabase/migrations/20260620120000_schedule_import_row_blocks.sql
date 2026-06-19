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
  row_blocks TEXT[];
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

  FOR item IN SELECT value FROM jsonb_array_elements(import_rows)
  LOOP
    target_id := NULLIF(item->>'id', '')::UUID;
    SELECT COALESCE(array_agg(value), '{}'::TEXT[])
    INTO row_blocks
    FROM jsonb_array_elements_text(
      COALESCE(item->'target_blocks', '[]'::JSONB)
    );

    IF target_id IS NULL THEN
      INSERT INTO practice_schedules (
        schedule_date,
        end_date,
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
        NULLIF(item->>'end_date', '')::DATE,
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
        row_blocks,
        target_sheet.id,
        auth.uid()
      );
    ELSE
      UPDATE practice_schedules
      SET
        schedule_date = (item->>'schedule_date')::DATE,
        end_date = NULLIF(item->>'end_date', '')::DATE,
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
        target_blocks = row_blocks,
        source_sheet_id = target_sheet.id
      WHERE id = target_id
        AND schedule_type = target_sheet.kind;

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
