"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShareButton } from "@/components/common/ShareButton";
import { ActionMenu } from "@/components/ui/action-menu";
import { NoteEditor } from "@/components/features/NoteEditor";
import { FormModal } from "@/components/ui/form-modal";
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
  const [editing, setEditing] = useState(false);

  async function remove() {
    const supabase = createClient();
    const { error } = await supabase.from("notes").delete().eq("id", note.id);
    if (error) {
      showToast("フォルダを削除できませんでした");
      return false;
    }
    router.push("/notes");
    router.refresh();
    return true;
  }

  return (
    <>
      {note.status === "published" && (
        <ShareButton
          title={note.title}
          text={`${note.title}｜ノート`}
          path={`/notes/${note.id}`}
          label={"このノートを共有する"}
        />
      )}
      {(canEdit || canDelete) && (
        <ActionMenu
          onEdit={canEdit ? () => setEditing(true) : undefined}
          onDelete={canDelete ? remove : undefined}
        deleteTitle="フォルダを削除しますか？"
        deleteDescription="フォルダ内のサブフォルダ・記事もすべて削除され、元に戻せません。"
        />
      )}
      {editing && (
        <FormModal
          open
          onOpenChange={setEditing}
          title="フォルダを編集"
        >
          <NoteEditor
            currentUser={currentUser}
            members={members}
            note={note}
            isAdmin={isAdmin}
            initialScope={note.scope}
            onDone={() => setEditing(false)}
          />
        </FormModal>
      )}
    </>
  );
}
