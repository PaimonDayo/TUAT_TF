-- コメントの最大文字数を200→500に緩和（オーナー確定 タスク12）。
ALTER TABLE comments
DROP CONSTRAINT IF EXISTS comments_content_check;

ALTER TABLE comments
ADD CONSTRAINT comments_content_check CHECK (char_length(content) <= 500);
