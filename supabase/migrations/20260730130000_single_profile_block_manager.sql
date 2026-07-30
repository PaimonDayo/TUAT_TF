-- Profile membership is now exactly one of middle_long, short, or manager.
-- Existing multi-block members are middle-long athletes. Specialist events stay untouched.
UPDATE public.profiles
SET blocks = CASE
  WHEN 'manager' = ANY(blocks) THEN ARRAY['manager']::TEXT[]
  WHEN cardinality(blocks) > 1 THEN ARRAY['middle_long']::TEXT[]
  WHEN blocks && ARRAY['jump', 'throw']::TEXT[] THEN ARRAY['short']::TEXT[]
  ELSE blocks
END
WHERE cardinality(blocks) > 1
   OR 'manager' = ANY(blocks)
   OR blocks && ARRAY['jump', 'throw']::TEXT[];

UPDATE public.profiles
SET attendance_default_block = 'all',
    attendance_view_all_blocks = TRUE
WHERE blocks = ARRAY['manager']::TEXT[];

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_blocks_single_membership;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_blocks_single_membership
  CHECK (
    cardinality(blocks) <= 1
    AND blocks <@ ARRAY['middle_long', 'short', 'manager']::TEXT[]
  );

-- Managers can read published menus for both competitive blocks.
CREATE OR REPLACE FUNCTION public.can_view_practice_menu(target_menu_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM practice_menus menu
    WHERE menu.id = target_menu_id
      AND (
        menu.author_id = auth.uid()
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
$$;
