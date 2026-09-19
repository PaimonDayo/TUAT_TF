-- 投稿の引用（引用リツイート相当）。つぶやき1件が、つぶやき・練習記録を1件だけ引用できる。
--
-- 引用元は likes / comments と同じ多相参照（種類＋ID）にして、外部キーは張らない。
-- 外部キーの ON DELETE SET NULL にすると、引用元が消えたときに「何を引用していたか」
-- ごと消えて、引用した本文だけが宙に浮く。参照を残しておけば「この投稿は削除されました」
-- と出せる。

ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS quoted_type TEXT;
ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS quoted_id UUID;

ALTER TABLE public.tweets DROP CONSTRAINT IF EXISTS tweets_quoted_target_check;
ALTER TABLE public.tweets ADD CONSTRAINT tweets_quoted_target_check CHECK (
  (quoted_type IS NULL AND quoted_id IS NULL)
  OR (quoted_type IN ('record', 'tweet') AND quoted_id IS NOT NULL)
);

-- 自分自身を引用する行は作らない（画面からは起きないが、自分を指し続ける行を残さない）。
ALTER TABLE public.tweets DROP CONSTRAINT IF EXISTS tweets_quoted_not_self_check;
ALTER TABLE public.tweets ADD CONSTRAINT tweets_quoted_not_self_check CHECK (
  quoted_type IS DISTINCT FROM 'tweet' OR quoted_id IS DISTINCT FROM id
);

-- 引用している行だけを索引に入れる（引用は全体から見れば少数）。
CREATE INDEX IF NOT EXISTS tweets_quoted_target_idx
  ON public.tweets (quoted_type, quoted_id)
  WHERE quoted_id IS NOT NULL;

COMMENT ON COLUMN public.tweets.quoted_type IS '引用元の種類 record|tweet。quoted_id と対で入る';
COMMENT ON COLUMN public.tweets.quoted_id IS '引用元のID。外部キーではないため、引用元が削除されるとその旨を表示する';

-- 本文の必須条件をゆるめる。引用だけして回す（本文なし）投稿を許す。
-- 既存の上限（8000文字・重み付き1000）はそのまま。
ALTER TABLE public.tweets DROP CONSTRAINT IF EXISTS tweets_content_check;
ALTER TABLE public.tweets ADD CONSTRAINT tweets_content_check CHECK (
  (char_length(btrim(content)) >= 1 OR image_path IS NOT NULL OR quoted_id IS NOT NULL)
  AND char_length(content) <= 8000
  AND tweet_weighted_length(content) <= 1000
);
