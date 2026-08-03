-- Story posts may contain only an image; regular posts still require text.
ALTER TABLE public.tweets
  DROP CONSTRAINT IF EXISTS tweets_content_check;

ALTER TABLE public.tweets
  ADD CONSTRAINT tweets_content_check CHECK (
    (char_length(btrim(content)) >= 1 OR image_path IS NOT NULL)
    AND char_length(content) <= 8000
    AND public.tweet_weighted_length(content) <= 1000
  );