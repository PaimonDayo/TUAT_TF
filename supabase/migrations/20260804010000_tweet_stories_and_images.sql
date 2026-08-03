ALTER TABLE public.tweets ADD COLUMN image_path TEXT, ADD COLUMN expires_at TIMESTAMPTZ;
ALTER TABLE public.tweets ADD CONSTRAINT tweets_expiry_after_creation CHECK (expires_at IS NULL OR expires_at > created_at);
CREATE INDEX idx_tweets_expires_at ON public.tweets(expires_at) WHERE expires_at IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tweet-images', 'tweet-images', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "tweet_image_insert_own_folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tweet-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "tweet_image_select_members" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tweet-images');
CREATE POLICY "tweet_image_delete_own_folder" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'tweet-images' AND (storage.foldername(name))[1] = auth.uid()::text);

COMMENT ON COLUMN public.tweets.expires_at IS 'NULL for regular posts; story posts expire 24 hours after creation';
