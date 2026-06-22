-- つぶやきの編集を可能にする UPDATE ポリシー。
-- init では tweets に select/insert/delete しか無く、本人でも UPDATE が
-- RLS で黙ってブロックされ（0件更新）「保存に失敗しました」になっていた。
-- 他テーブル（practice_records 等）と同じく本人のみ更新可とする。
DROP POLICY IF EXISTS "tweets_update" ON tweets;
CREATE POLICY "tweets_update" ON tweets
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
