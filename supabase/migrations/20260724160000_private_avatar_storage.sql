UPDATE storage.buckets
SET public = FALSE
WHERE id = 'avatars';

DROP POLICY IF EXISTS "avatar_insert_own_folder" ON storage.objects;
CREATE POLICY "avatar_insert_own_folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND public.is_member()
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
    AND LOWER(storage.extension(name)) IN ('webp', 'jpg', 'jpeg')
  );

DROP POLICY IF EXISTS "avatar_select_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "avatar_select_members" ON storage.objects;
CREATE POLICY "avatar_select_members"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND public.is_member()
  );

DROP POLICY IF EXISTS "avatar_delete_own_folder" ON storage.objects;
CREATE POLICY "avatar_delete_own_folder"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND public.is_member()
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
  );

UPDATE public.profiles
SET avatar_url = regexp_replace(
  avatar_url,
  '^https?://[^/]+/storage/v1/object/public/avatars/',
  ''
)
WHERE avatar_url ~ '^https?://[^/]+/storage/v1/object/public/avatars/';
