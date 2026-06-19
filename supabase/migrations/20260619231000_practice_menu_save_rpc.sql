CREATE OR REPLACE FUNCTION public.save_practice_menu(
  target_schedule_id UUID,
  menu_content TEXT,
  menu_status TEXT,
  menu_target_block TEXT DEFAULT NULL,
  target_user_ids UUID[] DEFAULT '{}',
  target_menu_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved_menu_id UUID;
BEGIN
  IF NOT public.can_create_menu() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF btrim(menu_content) = '' THEN
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
      status
    )
    VALUES (
      target_schedule_id,
      auth.uid(),
      btrim(menu_content),
      menu_target_block,
      menu_status
    )
    RETURNING id INTO saved_menu_id;
  ELSE
    UPDATE practice_menus
    SET
      schedule_id = target_schedule_id,
      content = btrim(menu_content),
      target_block = menu_target_block,
      status = menu_status,
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
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID[],
  UUID
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_practice_menu(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID[],
  UUID
) TO authenticated;
