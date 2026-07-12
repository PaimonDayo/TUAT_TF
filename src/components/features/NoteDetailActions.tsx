"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
        onEdit={canEdit ? () => setEditing(true) : undefined}
        onDelete={canDelete ? remove : undefined}
        deleteTitle="ノートフォルダを削除しますか？"
        deleteDescription="フォルダ内のサブフォルダ・記事もすべて削除され、元に戻せません。"
      />
      {editing && (
        <FormModal
          open
          onOpenChange={setEditing}
          title="フォルダ設定を編集"
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
