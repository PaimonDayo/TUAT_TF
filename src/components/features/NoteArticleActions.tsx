"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NoteArticleEditor } from "@/components/features/NoteArticleEditor";
import { ActionMenu } from "@/components/ui/action-menu";
import { FormModal } from "@/components/ui/form-modal";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import type { AuthorMini, NoteArticleWithAuthor } from "@/types";

export function NoteArticleActions({
  noteId,
  article,
  currentUser,
}: {
  noteId: string;
  article: NoteArticleWithAuthor;
  currentUser: AuthorMini;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);

  async function remove() {
    const supabase = createClient();
    const { error } = await supabase
      .from("note_articles")
      .delete()
      .eq("id", article.id)
      .eq("note_id", noteId);
    if (error) {
      showToast("記事を削除できませんでした");
      return false;
    }
    router.push(`/notes/${noteId}`);
    router.refresh();
    return true;
  }

  return (
    <>
      <ActionMenu
        onEdit={() => setEditing(true)}
        onDelete={remove}
        deleteTitle="記事を削除しますか？"
        deleteDescription="削除した記事は元に戻せません。"
      />
      {editing && (
        <FormModal open onOpenChange={setEditing} title="記事を編集">
          <NoteArticleEditor
            noteId={noteId}
            currentUser={currentUser}
            article={article}
            onDone={() => setEditing(false)}
          />
        </FormModal>
      )}
    </>
  );
}
