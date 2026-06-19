CREATE TABLE IF NOT EXISTS note_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  sort INT NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  theme_id UUID REFERENCES note_themes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  edit_policy TEXT NOT NULL DEFAULT 'author',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS note_editors (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_theme ON notes(theme_id);
CREATE INDEX IF NOT EXISTS idx_notes_author ON notes(author_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_editors_user ON note_editors(user_id);

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_scope_check;
ALTER TABLE notes ADD CONSTRAINT notes_scope_check
CHECK (scope IN ('shared', 'personal'));

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_status_check;
ALTER TABLE notes ADD CONSTRAINT notes_status_check
CHECK (status IN ('draft', 'published'));

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_edit_policy_check;
ALTER TABLE notes ADD CONSTRAINT notes_edit_policy_check
CHECK (edit_policy IN ('everyone', 'specified', 'author'));

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_personal_shape_check;
ALTER TABLE notes ADD CONSTRAINT notes_personal_shape_check
CHECK (
  scope = 'shared'
  OR (scope = 'personal' AND theme_id IS NULL AND edit_policy = 'author')
);

CREATE OR REPLACE FUNCTION public.touch_note_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notes_touch_updated_at ON notes;
CREATE TRIGGER notes_touch_updated_at
BEFORE UPDATE ON notes
FOR EACH ROW EXECUTE FUNCTION public.touch_note_updated_at();

CREATE OR REPLACE FUNCTION public.can_edit_note(target_note_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM notes note
    WHERE note.id = target_note_id
      AND (
        note.author_id = auth.uid()
        OR (
          note.scope = 'shared'
          AND (
            public.is_admin()
            OR note.edit_policy = 'everyone'
            OR (
              note.edit_policy = 'specified'
              AND EXISTS (
                SELECT 1
                FROM note_editors editor
                WHERE editor.note_id = note.id
                  AND editor.user_id = auth.uid()
              )
            )
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_note(target_note_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM notes note
    WHERE note.id = target_note_id
      AND (
        note.status = 'published'
        OR note.author_id = auth.uid()
        OR public.is_admin()
        OR public.can_edit_note(note.id)
      )
  );
$$;

ALTER TABLE note_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_editors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "note_themes_select" ON note_themes;
DROP POLICY IF EXISTS "note_themes_insert" ON note_themes;
DROP POLICY IF EXISTS "note_themes_update" ON note_themes;
DROP POLICY IF EXISTS "note_themes_delete" ON note_themes;

CREATE POLICY "note_themes_select"
ON note_themes FOR SELECT
USING (TRUE);

CREATE POLICY "note_themes_insert"
ON note_themes FOR INSERT
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "note_themes_update"
ON note_themes FOR UPDATE
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "note_themes_delete"
ON note_themes FOR DELETE
USING (public.is_admin());

DROP POLICY IF EXISTS "notes_select" ON notes;
DROP POLICY IF EXISTS "notes_insert" ON notes;
DROP POLICY IF EXISTS "notes_update" ON notes;
DROP POLICY IF EXISTS "notes_delete" ON notes;

CREATE POLICY "notes_select"
ON notes FOR SELECT
USING (public.can_view_note(id));

CREATE POLICY "notes_insert"
ON notes FOR INSERT
WITH CHECK (
  auth.uid() = author_id
  AND (
    scope = 'shared'
    OR (scope = 'personal' AND theme_id IS NULL AND edit_policy = 'author')
  )
);

CREATE POLICY "notes_update"
ON notes FOR UPDATE
USING (public.can_edit_note(id))
WITH CHECK (
  public.can_edit_note(id)
  AND (
    scope = 'shared'
    OR (scope = 'personal' AND author_id = auth.uid() AND theme_id IS NULL AND edit_policy = 'author')
  )
);

CREATE POLICY "notes_delete"
ON notes FOR DELETE
USING (author_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "note_editors_select" ON note_editors;
DROP POLICY IF EXISTS "note_editors_insert" ON note_editors;
DROP POLICY IF EXISTS "note_editors_delete" ON note_editors;

CREATE POLICY "note_editors_select"
ON note_editors FOR SELECT
USING (public.can_view_note(note_id));

CREATE POLICY "note_editors_insert"
ON note_editors FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM notes note
    WHERE note.id = note_id
      AND (note.author_id = auth.uid() OR public.is_admin())
  )
);

CREATE POLICY "note_editors_delete"
ON note_editors FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM notes note
    WHERE note.id = note_id
      AND (note.author_id = auth.uid() OR public.is_admin())
  )
);
