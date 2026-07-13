ALTER TABLE threads
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES notes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS threads_folder_updated_idx
  ON threads(folder_id, updated_at DESC);

DROP POLICY IF EXISTS threads_select ON threads;
CREATE POLICY threads_select ON threads FOR SELECT TO authenticated
  USING (folder_id IS NULL OR public.can_view_note(folder_id));

DROP POLICY IF EXISTS threads_insert ON threads;
CREATE POLICY threads_insert ON threads FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND (folder_id IS NULL OR public.can_view_note(folder_id))
  );
