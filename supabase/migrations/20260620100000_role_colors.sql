ALTER TABLE roles
ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#007aff';

ALTER TABLE roles
DROP CONSTRAINT IF EXISTS roles_color_check;

ALTER TABLE roles
ADD CONSTRAINT roles_color_check
CHECK (color ~ '^#[0-9A-Fa-f]{6}$');
