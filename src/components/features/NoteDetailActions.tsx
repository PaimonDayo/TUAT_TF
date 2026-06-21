"use client";

import { useRouter } from "next/navigation";
import { ActionMenu } from "@/components/ui/action-menu";
import { NoteEditorButton } from "@/components/features/NoteEditor";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import type { AuthorMini, NoteWithRelations } from "@/types";

export function NoteDetailActions({
  note,
  currentUser,
  members,
  isAdmin,
  canEdit,
  canDelete,
}: {
  note: NoteWithRelations;
  currentUser: AuthorMini;
  members: AuthorMini[];
  isAdmin: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();

  async function remove() {
    const supabase = createClient();
    const { error } = await supabase.from("notes").delete().eq("id", note.id);
    if (error) {
      showToast("ノートフォルダを削除できませんでした");
      return false;
    }
    router.push("/notes");
    router.refresh();
    return true;
  }

  return (
    <>
      <ActionMenu
        onEdit={
          canEdit
            ? () => {
                document
                  .querySelector<HTMLButtonElement>(`#edit-note-${note.id} button`)
                  ?.click();
              }
            : undefined
        }
        onDelete={canDelete ? remove : undefined}
        deleteTitle="ノートフォルダを削除しますか？"
        deleteDescription="フォルダ内の記事もすべて削除され、元に戻せません。"
      />
      {canEdit && (
        <span id={`edit-note-${note.id}`} className="hidden">
          <NoteEditorButton
            currentUser={currentUser}
            members={members}
            note={note}
            isAdmin={isAdmin}
            label="フォルダ設定を編集"
          />
        </span>
      )}
    </>
  );
}
