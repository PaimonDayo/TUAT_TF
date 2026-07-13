ALTER TABLE notes ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE note_articles ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS notes_pinned_updated_idx ON notes(pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS note_articles_pinned_updated_idx ON note_articles(note_id, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS threads_folder_pinned_updated_idx ON threads(folder_id, pinned DESC, updated_at DESC);

