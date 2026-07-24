UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/webp', 'image/jpeg']
WHERE id = 'avatars';

DROP POLICY IF EXISTS "avatar_insert_own_folder" ON storage.objects;
CREATE POLICY "avatar_insert_own_folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
    AND LOWER(storage.extension(name)) IN ('webp', 'jpg', 'jpeg')
  );
