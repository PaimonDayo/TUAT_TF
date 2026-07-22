-- つぶやきを本文1,000文字まで拡張し、長いURLは1件23文字として数える。
-- 保存値そのものにも上限を設け、極端に長いURLや直接API呼び出しを防ぐ。
CREATE OR REPLACE FUNCTION public.tweet_weighted_length(value TEXT)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
STRICT
SET search_path = public
AS $$
  SELECT
    char_length(regexp_replace(value, 'https?://[^[:space:]<>)]+', '', 'gi'))
    + 23 * (
      SELECT count(*)::INTEGER
      FROM regexp_matches(value, 'https?://[^[:space:]<>)]+', 'gi')
    );
$$;

ALTER TABLE public.tweets
DROP CONSTRAINT IF EXISTS tweets_content_check;

ALTER TABLE public.tweets
ADD CONSTRAINT tweets_content_check CHECK (
  char_length(btrim(content)) BETWEEN 1 AND 8000
  AND public.tweet_weighted_length(content) <= 1000
);
