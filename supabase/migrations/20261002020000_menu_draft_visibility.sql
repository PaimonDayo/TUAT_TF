-- Drafts belong to their author and the leaders responsible for their block.
-- The personal all-blocks preference expands published menus only.
-- Existing menu/target SELECT policies both call this function; no data rewrite.
CREATE OR REPLACE FUNCTION public.can_view_practice_menu(target_menu_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.practice_menus menu
    WHERE menu.id = target_menu_id
      AND (
        menu.author_id = auth.uid()
        OR public.can_edit_block_menu(menu.target_block)
        OR (
          menu.status = 'published'
          AND (
            COALESCE(
              (SELECT p.menu_view_all_blocks FROM public.profiles p WHERE p.id = auth.uid()),
              FALSE
            )
            OR EXISTS (
              SELECT 1
              FROM public.practice_menu_targets target
              WHERE target.menu_id = menu.id
                AND target.user_id = auth.uid()
            )
            OR (
              menu.target_block IS NOT NULL
              AND (
                menu.target_block = ANY (
                  COALESCE(
                    (SELECT profile.blocks FROM public.profiles profile WHERE profile.id = auth.uid()),
                    '{}'::TEXT[]
                  )
                )
                OR (
                  menu.target_block IN ('middle_long', 'short')
                  AND 'manager' = ANY (
                    COALESCE(
                      (SELECT profile.blocks FROM public.profiles profile WHERE profile.id = auth.uid()),
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
                FROM public.practice_menu_targets target
                WHERE target.menu_id = menu.id
              )
            )
          )
        )
      )
  );
$function$;
