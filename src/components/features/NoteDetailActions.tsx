"use client";

import { useRouter } from "next/navigation";
import { ActionMenu } from "@/components/ui/action-menu";
import { NoteEditorButton } from "@/components/features/NoteEditor";
import { createClient } from "@/lib/supabase/client";
import type { AuthorMini, NoteTheme, NoteWithRelations } from "@/types";

export function NoteDetailActions({
  note,
  currentUser,
  members,
  themes,
  isAdmin,
  canEdit,
  canDelete,
}: {
  note: NoteWithRelations;
  currentUser: AuthorMini;
  members: AuthorMini[];
  themes: NoteTheme[];
  isAdmin: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();

  async function remove() {
    const supabase = createClient();
    const { error } = await supabase.from("notes").delete().eq("id", note.id);
    if (error) return false;
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
        deleteTitle="ノートを削除しますか？"
        deleteDescription="削除したノートは元に戻せません。"
      />
      {canEdit && (
        <span id={`edit-note-${note.id}`} className="hidden">
          <NoteEditorButton
            currentUser={currentUser}
            members={members}
            themes={themes}
            note={note}
            isAdmin={isAdmin}
            label="編集"
          />
        </span>
      )}
    </>
  );
}
