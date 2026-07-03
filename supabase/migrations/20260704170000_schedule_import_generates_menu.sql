-- 予定インポートの行にメニュー/ペース/補足/補強があれば、対応するブロック全体メニューも
-- 同時に生成/更新する（実物スプシは1シートに予定とメニューが同居しているため）。
-- 単一ブロック指定の行のみ対象（"全体"=複数ブロックの行はどのブロックのメニューか
-- 一意に決まらないため対象外）。
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
  resolved_schedule_id UUID;
  row_blocks TEXT[];
  menu_content TEXT;
  menu_pace TEXT;
  menu_remark TEXT;
  menu_supplement TEXT;
  existing_menu_id UUID;
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
      )
      RETURNING id INTO resolved_schedule_id;
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
      resolved_schedule_id := target_id;
    END IF;

    IF target_sheet.kind = 'practice' AND array_length(row_blocks, 1) = 1 THEN
      menu_content := NULLIF(item->>'menu_content', '');
      menu_pace := NULLIF(item->>'menu_pace', '');
      menu_remark := NULLIF(item->>'menu_remark', '');
      menu_supplement := NULLIF(item->>'menu_supplement', '');

      IF menu_content IS NOT NULL OR menu_pace IS NOT NULL
        OR menu_remark IS NOT NULL OR menu_supplement IS NOT NULL THEN
        SELECT pm.id INTO existing_menu_id
        FROM practice_menus pm
        WHERE pm.schedule_id = resolved_schedule_id
          AND pm.target_block = row_blocks[1]
          AND NOT EXISTS (
            SELECT 1 FROM practice_menu_targets t WHERE t.menu_id = pm.id
          )
        LIMIT 1;

        IF existing_menu_id IS NULL THEN
          INSERT INTO practice_menus (
            schedule_id, author_id, content, pace, remark, supplement, target_block, status
          ) VALUES (
            resolved_schedule_id, auth.uid(), COALESCE(menu_content, ''),
            menu_pace, menu_remark, menu_supplement, row_blocks[1], 'published'
          );
        ELSE
          UPDATE practice_menus
          SET
            content = COALESCE(menu_content, ''),
            pace = menu_pace,
            remark = menu_remark,
            supplement = menu_supplement,
            updated_at = NOW()
          WHERE id = existing_menu_id;
        END IF;
      END IF;
    END IF;
  END LOOP;

  UPDATE schedule_sheets
  SET last_imported_at = NOW()
  WHERE id = target_sheet.id;
END;
$$;
