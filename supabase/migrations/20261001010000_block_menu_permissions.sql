-- Block leaders may edit menus in their current app block; deletion stays unchanged.
-- No table or role-assignment change; no new mirror target.
CREATE OR REPLACE FUNCTION public.can_edit_block_menu(target_block text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT auth.uid() IS NOT NULL AND public.can_create_menu() AND EXISTS (
  SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
  WHERE pr.profile_id=auth.uid() AND (
   (target_block='middle_long' AND r.name IN ('中距離ブロック長','長距離ブロック長'))
   OR (target_block IN ('short','jump','throw') AND r.name IN ('短距離ブロック長','投擲ブロック長','跳躍ブロック長'))
  )
 );
$$;
REVOKE ALL ON FUNCTION public.can_edit_block_menu(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_block_menu(text) TO authenticated;

-- Target membership changes must have the same scope as editing the menu.
CREATE OR REPLACE FUNCTION public.can_edit_practice_menu(target_menu_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.practice_menus m WHERE m.id=target_menu_id AND (
   public.can_manage_members() OR (m.author_id=auth.uid() AND public.can_create_menu())
   OR public.can_edit_block_menu(m.target_block)
  )
 );
$$;
REVOKE ALL ON FUNCTION public.can_edit_practice_menu(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_practice_menu(uuid) TO authenticated;
DROP POLICY IF EXISTS menu_targets_insert ON public.practice_menu_targets;
CREATE POLICY menu_targets_insert ON public.practice_menu_targets FOR INSERT TO authenticated
WITH CHECK (public.can_edit_practice_menu(menu_id));
DROP POLICY IF EXISTS menu_targets_delete ON public.practice_menu_targets;
CREATE POLICY menu_targets_delete ON public.practice_menu_targets FOR DELETE TO authenticated
USING (public.can_edit_practice_menu(menu_id));

-- Both the old and new block must remain inside the editor's scope.
CREATE OR REPLACE FUNCTION public.guard_block_menu_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.is_mirror_write() OR auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF NOT public.can_manage_members() AND OLD.author_id IS DISTINCT FROM auth.uid() THEN
  IF NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NOT public.can_edit_block_menu(OLD.target_block)
     OR NOT public.can_edit_block_menu(NEW.target_block) THEN
    RAISE EXCEPTION 'menu outside editable block' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_block_menu_edit ON public.practice_menus;
CREATE TRIGGER guard_block_menu_edit BEFORE UPDATE ON public.practice_menus
FOR EACH ROW EXECUTE FUNCTION public.guard_block_menu_edit();

DROP POLICY IF EXISTS menus_update ON public.practice_menus;
CREATE POLICY menus_update ON public.practice_menus FOR UPDATE TO authenticated
USING ((auth.uid()=author_id AND public.can_create_menu()) OR public.can_manage_members() OR public.can_edit_block_menu(target_block))
WITH CHECK ((auth.uid()=author_id AND public.can_create_menu()) OR public.can_manage_members() OR public.can_edit_block_menu(target_block));

CREATE OR REPLACE FUNCTION public.can_view_practice_menu(target_menu_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM practice_menus menu
    WHERE menu.id = target_menu_id
      AND (
        menu.author_id = auth.uid()
        OR public.can_edit_block_menu(menu.target_block)
        OR COALESCE(
          (SELECT p.menu_view_all_blocks FROM profiles p WHERE p.id = auth.uid()),
          FALSE
        )
        OR (
          menu.status = 'published'
          AND (
            EXISTS (
              SELECT 1
              FROM practice_menu_targets target
              WHERE target.menu_id = menu.id
                AND target.user_id = auth.uid()
            )
            OR (
              menu.target_block IS NOT NULL
              AND (
                menu.target_block = ANY (
                  COALESCE(
                    (SELECT profile.blocks FROM profiles profile WHERE profile.id = auth.uid()),
                    '{}'::TEXT[]
                  )
                )
                OR (
                  menu.target_block IN ('middle_long', 'short')
                  AND 'manager' = ANY (
                    COALESCE(
                      (SELECT profile.blocks FROM profiles profile WHERE profile.id = auth.uid()),
                      '{}'::TEXT[]
                    )
                  )
                )
              )
            )
            OR (
              menu.target_block IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM practice_menu_targets target
                WHERE target.menu_id = menu.id
              )
            )
          )
        )
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.save_practice_menu(target_schedule_id uuid, menu_content text, menu_status text, menu_target_block text DEFAULT NULL::text, target_user_ids uuid[] DEFAULT '{}'::uuid[], target_menu_id uuid DEFAULT NULL::uuid, menu_pace text DEFAULT NULL::text, menu_remark text DEFAULT NULL::text, menu_supplement text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  saved_menu_id UUID;
  existing_menu public.practice_menus%ROWTYPE;
  clean_content TEXT := btrim(COALESCE(menu_content, ''));
  clean_pace TEXT := NULLIF(btrim(COALESCE(menu_pace, '')), '');
  clean_remark TEXT := NULLIF(btrim(COALESCE(menu_remark, '')), '');
  clean_supplement TEXT := NULLIF(btrim(COALESCE(menu_supplement, '')), '');
BEGIN
  IF auth.uid() IS NULL OR (target_menu_id IS NULL AND NOT public.can_create_menu()) THEN
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
    SELECT * INTO existing_menu FROM public.practice_menus WHERE id=target_menu_id FOR UPDATE;
    IF existing_menu.id IS NULL OR NOT (
      public.can_manage_members()
      OR (existing_menu.author_id=auth.uid() AND public.can_create_menu())
      OR (public.can_edit_block_menu(existing_menu.target_block) AND public.can_edit_block_menu(menu_target_block))
    ) THEN RAISE EXCEPTION 'menu not found or not editable' USING ERRCODE='42501'; END IF;
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
$function$;

-- The everyone role must work identically for all six flags.
CREATE OR REPLACE FUNCTION public.can_decide_practice()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.roles r WHERE r.can_decide_practice AND
   (r.is_everyone OR EXISTS(SELECT 1 FROM public.profile_roles pr WHERE pr.role_id=r.id AND pr.profile_id=auth.uid()))
 );
$$;
