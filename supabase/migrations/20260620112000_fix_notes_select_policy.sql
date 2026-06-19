DROP POLICY IF EXISTS "notes_select" ON notes;

CREATE POLICY "notes_select"
ON notes
FOR SELECT
USING (
  status = 'published'
  OR author_id = auth.uid()
  OR public.is_admin()
  OR public.can_edit_note(id)
);
