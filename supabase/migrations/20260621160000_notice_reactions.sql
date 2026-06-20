CREATE TABLE IF NOT EXISTS notice_reactions (
  notice_id UUID NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notice_id, user_id, reaction)
);

ALTER TABLE notice_reactions DROP CONSTRAINT IF EXISTS notice_reactions_reaction_check;
ALTER TABLE notice_reactions ADD CONSTRAINT notice_reactions_reaction_check
CHECK (reaction IN ('ack', 'thanks', 'question'));

CREATE INDEX IF NOT EXISTS idx_notice_reactions_notice
ON notice_reactions(notice_id);

ALTER TABLE notice_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notice_reactions_select" ON notice_reactions;
DROP POLICY IF EXISTS "notice_reactions_insert" ON notice_reactions;
DROP POLICY IF EXISTS "notice_reactions_delete" ON notice_reactions;

CREATE POLICY "notice_reactions_select"
ON notice_reactions FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "notice_reactions_insert"
ON notice_reactions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notice_reactions_delete"
ON notice_reactions FOR DELETE
USING (auth.uid() = user_id);
