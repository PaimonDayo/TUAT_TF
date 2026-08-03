-- Images are intentionally limited to expiring story posts.
ALTER TABLE public.tweets
  ADD CONSTRAINT tweets_images_require_expiry
  CHECK (image_path IS NULL OR expires_at IS NOT NULL);