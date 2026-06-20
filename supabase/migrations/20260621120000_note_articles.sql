ALTER TABLE notes ALTER COLUMN body SET DEFAULT '';

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_personal_shape_check;
ALTER TABLE notes ADD CONSTRAINT notes_personal_shape_check
CHECK (
  scope = 'shared'
  OR (scope = 'personal' AND theme_id IS NULL)
);

CREATE TABLE IF NOT EXISTS note_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_note_articles_note_updated
ON note_articles(note_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_note_articles_author
ON note_articles(author_id);

CREATE OR REPLACE FUNCTION public.touch_note_article_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS note_articles_touch_updated_at ON note_articles;
CREATE TRIGGER note_articles_touch_updated_at
BEFORE UPDATE ON note_articles
FOR EACH ROW EXECUTE FUNCTION public.touch_note_article_updated_at();

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
        OR public.is_admin()
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
  );
$$;

DROP POLICY IF EXISTS "notes_insert" ON notes;
CREATE POLICY "notes_insert"
ON notes FOR INSERT
WITH CHECK (
  auth.uid() = author_id
  AND (
    scope = 'shared'
    OR (scope = 'personal' AND theme_id IS NULL)
  )
);

DROP POLICY IF EXISTS "notes_update" ON notes;
CREATE POLICY "notes_update"
ON notes FOR UPDATE
USING (public.can_edit_note(id))
WITH CHECK (
  public.can_edit_note(id)
  AND (
    scope = 'shared'
    OR (scope = 'personal' AND theme_id IS NULL)
  )
);

ALTER TABLE note_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "note_articles_select" ON note_articles;
DROP POLICY IF EXISTS "note_articles_insert" ON note_articles;
DROP POLICY IF EXISTS "note_articles_update" ON note_articles;
DROP POLICY IF EXISTS "note_articles_delete" ON note_articles;

CREATE POLICY "note_articles_select"
ON note_articles FOR SELECT
USING (public.can_view_note(note_id));

CREATE POLICY "note_articles_insert"
ON note_articles FOR INSERT
WITH CHECK (
  auth.uid() = author_id
  AND public.can_edit_note(note_id)
);

CREATE POLICY "note_articles_update"
ON note_articles FOR UPDATE
USING (public.can_edit_note(note_id))
WITH CHECK (public.can_edit_note(note_id));

CREATE POLICY "note_articles_delete"
ON note_articles FOR DELETE
USING (public.can_edit_note(note_id));

INSERT INTO note_articles (
  id,
  note_id,
  author_id,
  title,
  body,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  note.id,
  note.author_id,
  note.title,
  note.body,
  note.created_at,
  note.updated_at
FROM notes note
WHERE BTRIM(note.body) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM note_articles article
    WHERE article.note_id = note.id
  );
