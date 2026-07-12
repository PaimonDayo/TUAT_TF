-- ノートフォルダの入れ子（タスク17-a、オーナー確定 2026-07-13）
-- parent_id=NULL がルート。深さ制限(3階層)はUI側で担保する。
-- 参照制約はデフォルト(NO ACTION)のため、サブフォルダを持つフォルダはDBレベルで削除不可
-- （=「中身が空のときだけ削除できる」仕様の下半分。記事は従来どおりcascade）。
ALTER TABLE notes ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES notes(id);
CREATE INDEX IF NOT EXISTS idx_notes_parent_id ON notes(parent_id);
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_parent_not_self;
ALTER TABLE notes ADD CONSTRAINT notes_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);
