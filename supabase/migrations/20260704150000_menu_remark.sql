-- 練習メニューに「補足」(remark)を追加。中長距離の並びは メニュー→ペース→補足→補強。
ALTER TABLE practice_menus
ADD COLUMN IF NOT EXISTS remark TEXT;

DROP FUNCTION IF EXISTS public.save_practice_menu(UUID, TEXT, TEXT, TEXT, UUID[], UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.save_practice_menu(
  target_schedule_id UUID,
  menu_content TEXT,
  menu_status TEXT,
  menu_target_block TEXT DEFAULT NULL,
  target_user_ids UUID[] DEFAULT '{}',
  target_menu_id UUID DEFAULT NULL,
  menu_pace TEXT DEFAULT NULL,
  menu_remark TEXT DEFAULT NULL,
  menu_supplement TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved_menu_id UUID;
  clean_content TEXT := btrim(COALESCE(menu_content, ''));
  clean_pace TEXT := NULLIF(btrim(COALESCE(menu_pace, '')), '');
  clean_remark TEXT := NULLIF(btrim(COALESCE(menu_remark, '')), '');
  clean_supplement TEXT := NULLIF(btrim(COALESCE(menu_supplement, '')), '');
BEGIN
  IF NOT public.can_create_menu() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF clean_content = '' AND clean_pace IS NULL AND clean_remark IS NULL AND clean_supplement IS NULL THEN
    RAISE EXCEPTION 'content is required';
  END IF;

  IF menu_status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  IF menu_target_block IS NOT NULL
    AND menu_target_block NOT IN ('middle_long', 'short', 'jump', 'throw') THEN
    RAISE EXCEPTION 'invalid target block';
  END IF;

  IF target_menu_id IS NULL THEN
    INSERT INTO practice_menus (
      schedule_id,
      author_id,
      content,
      target_block,
      status,
      pace,
      remark,
      supplement
    )
    VALUES (
      target_schedule_id,
      auth.uid(),
      clean_content,
      menu_target_block,
      menu_status,
      clean_pace,
      clean_remark,
      clean_supplement
    )
    RETURNING id INTO saved_menu_id;
  ELSE
    UPDATE practice_menus
    SET
      schedule_id = target_schedule_id,
      content = clean_content,
      target_block = menu_target_block,
      status = menu_status,
      pace = clean_pace,
      remark = clean_remark,
      supplement = clean_supplement,
      updated_at = NOW()
    WHERE id = target_menu_id
      AND (
        author_id = auth.uid()
        OR public.can_manage_members()
      )
    RETURNING id INTO saved_menu_id;

    IF saved_menu_id IS NULL THEN
      RAISE EXCEPTION 'menu not found or not editable';
    END IF;
  END IF;

  DELETE FROM practice_menu_targets
  WHERE menu_id = saved_menu_id;

  INSERT INTO practice_menu_targets (menu_id, user_id)
  SELECT saved_menu_id, target_user_id
  FROM unnest(COALESCE(target_user_ids, '{}'::UUID[])) AS target_user_id
  ON CONFLICT DO NOTHING;

  RETURN saved_menu_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_practice_menu(
  UUID, TEXT, TEXT, TEXT, UUID[], UUID, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_practice_menu(
  UUID, TEXT, TEXT, TEXT, UUID[], UUID, TEXT, TEXT, TEXT
) TO authenticated;
