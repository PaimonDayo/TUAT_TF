DROP POLICY IF EXISTS "avatar_select_own_folder" ON storage.objects;
CREATE POLICY "avatar_select_own_folder"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
  );
