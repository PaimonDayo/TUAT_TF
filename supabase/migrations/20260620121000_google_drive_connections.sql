CREATE TABLE IF NOT EXISTS google_drive_connections (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  refresh_token_encrypted TEXT NOT NULL,
  google_email TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE google_drive_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_drive_connections_select" ON google_drive_connections;
DROP POLICY IF EXISTS "google_drive_connections_delete" ON google_drive_connections;

CREATE POLICY "google_drive_connections_select"
ON google_drive_connections
FOR SELECT
USING (auth.uid() = profile_id);

CREATE POLICY "google_drive_connections_delete"
ON google_drive_connections
FOR DELETE
USING (auth.uid() = profile_id);
