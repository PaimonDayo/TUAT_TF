CREATE OR REPLACE FUNCTION public.can_edit_note(target_note_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
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
