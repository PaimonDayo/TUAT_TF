ALTER TABLE practice_menus
ADD COLUMN IF NOT EXISTS target_block TEXT;

ALTER TABLE practice_menus
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE practice_menus
DROP CONSTRAINT IF EXISTS practice_menus_target_block_check;

ALTER TABLE practice_menus
ADD CONSTRAINT practice_menus_target_block_check
CHECK (
  target_block IS NULL
  OR target_block IN ('middle_long', 'short', 'jump', 'throw')
);

ALTER TABLE practice_menus
DROP CONSTRAINT IF EXISTS practice_menus_status_check;

ALTER TABLE practice_menus
ADD CONSTRAINT practice_menus_status_check
CHECK (status IN ('draft', 'published'));

UPDATE practice_menus
SET status = 'published'
WHERE status = 'draft'
  AND created_at < NOW();

CREATE TABLE IF NOT EXISTS practice_menu_targets (
  menu_id UUID NOT NULL REFERENCES practice_menus(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_targets_user
ON practice_menu_targets(user_id);

CREATE TABLE IF NOT EXISTS menu_target_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  user_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE practice_menu_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_target_presets ENABLE ROW LEVEL SECURITY;

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
        public.can_create_menu()
        OR menu.author_id = auth.uid()
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
              NOT EXISTS (
                SELECT 1
                FROM practice_menu_targets target
                WHERE target.menu_id = menu.id
              )
              AND (
                menu.target_block IS NULL
                OR menu.target_block = ANY (
                  COALESCE(
                    (SELECT profile.blocks FROM profiles profile WHERE profile.id = auth.uid()),
                    '{}'::TEXT[]
                  )
                )
              )
            )
          )
        )
      )
  );
$$;

DROP POLICY IF EXISTS "menus_select" ON practice_menus;
DROP POLICY IF EXISTS "menus_insert" ON practice_menus;
DROP POLICY IF EXISTS "menus_update" ON practice_menus;
DROP POLICY IF EXISTS "menus_delete" ON practice_menus;

CREATE POLICY "menus_select"
ON practice_menus
FOR SELECT
USING (public.can_view_practice_menu(id));

CREATE POLICY "menus_insert"
ON practice_menus
FOR INSERT
WITH CHECK (
  auth.uid() = author_id
  AND public.can_create_menu()
);

CREATE POLICY "menus_update"
ON practice_menus
FOR UPDATE
USING (
  (auth.uid() = author_id AND public.can_create_menu())
  OR public.can_manage_members()
)
WITH CHECK (
  (auth.uid() = author_id AND public.can_create_menu())
  OR public.can_manage_members()
);

CREATE POLICY "menus_delete"
ON practice_menus
FOR DELETE
USING (
  (auth.uid() = author_id AND public.can_create_menu())
  OR public.can_manage_members()
);

DROP POLICY IF EXISTS "menu_targets_select" ON practice_menu_targets;
DROP POLICY IF EXISTS "menu_targets_insert" ON practice_menu_targets;
DROP POLICY IF EXISTS "menu_targets_delete" ON practice_menu_targets;

CREATE POLICY "menu_targets_select"
ON practice_menu_targets
FOR SELECT
USING (public.can_view_practice_menu(menu_id));

CREATE POLICY "menu_targets_insert"
ON practice_menu_targets
FOR INSERT
WITH CHECK (public.can_create_menu());

CREATE POLICY "menu_targets_delete"
ON practice_menu_targets
FOR DELETE
USING (public.can_create_menu() OR public.can_manage_members());

DROP POLICY IF EXISTS "menu_presets_select" ON menu_target_presets;
DROP POLICY IF EXISTS "menu_presets_insert" ON menu_target_presets;
DROP POLICY IF EXISTS "menu_presets_update" ON menu_target_presets;
DROP POLICY IF EXISTS "menu_presets_delete" ON menu_target_presets;

CREATE POLICY "menu_presets_select"
ON menu_target_presets
FOR SELECT
USING (auth.uid() = author_id);

CREATE POLICY "menu_presets_insert"
ON menu_target_presets
FOR INSERT
WITH CHECK (auth.uid() = author_id);

CREATE POLICY "menu_presets_update"
ON menu_target_presets
FOR UPDATE
USING (auth.uid() = author_id)
WITH CHECK (auth.uid() = author_id);

CREATE POLICY "menu_presets_delete"
ON menu_target_presets
FOR DELETE
USING (auth.uid() = author_id);
