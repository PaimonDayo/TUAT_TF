-- お知らせの通知先ブロックにマネージャーを追加する。
--
-- これまで mentioned_blocks は middle_long/short/jump/throw しか許可しておらず、
-- blocks = ['manager'] の部員はブロック指定ではどう選んでも通知が届かなかった。
-- 通知トリガー側は profiles.blocks との配列重なり（&&）で判定しているため、
-- 制約に 'manager' を足すだけでマネージャーを直接指定できるようになる。
-- jump/throw は 20260722110000 で short へ寄せた過去互換の値として残す。
ALTER TABLE public.notices
  DROP CONSTRAINT IF EXISTS notices_mentioned_blocks_check;
ALTER TABLE public.notices
  ADD CONSTRAINT notices_mentioned_blocks_check
  CHECK (mentioned_blocks <@ ARRAY['middle_long', 'short', 'manager', 'jump', 'throw']::TEXT[]);
