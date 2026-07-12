-- フォルダごと削除（タスク17改・オーナー確定 2026-07-13）
-- 「サブフォルダがあると削除不可」をやめ、親フォルダ削除で配下のサブフォルダ・記事も
-- まとめて削除する（記事は既存の note_articles の cascade が各フォルダに対して効く）。
-- 削除確認ダイアログ側で「サブフォルダと記事もすべて削除される」旨を明示する。
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_parent_id_fkey;
ALTER TABLE notes
  ADD CONSTRAINT notes_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES notes(id) ON DELETE CASCADE;
