-- System management may read every folder, including other authors' drafts.
-- Keep existing author/editor/member-management access and mutation permissions.
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
        OR public.can_manage_system()
        OR public.can_edit_note(note.id)
      )
  );
$$;

DROP POLICY IF EXISTS "notes_select" ON public.notes;
CREATE POLICY "notes_select"
ON public.notes
FOR SELECT
USING (
  status = 'published'
  OR author_id = auth.uid()
  OR public.is_admin()
  OR public.can_manage_system()
  OR public.can_edit_note(id)
);

-- No tables or row data change; existing failover triggers remain unchanged.
