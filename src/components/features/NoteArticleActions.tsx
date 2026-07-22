"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShareButton } from "@/components/common/ShareButton";
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
  canEdit = true,
  canShare = true,
}: {
  noteId: string;
  article: NoteArticleWithAuthor;
  currentUser: AuthorMini;
  canEdit?: boolean;
  canShare?: boolean;
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

  async function togglePin() {
    const { error } = await createClient()
      .from("note_articles")
      .update({ pinned: !article.pinned })
      .eq("id", article.id)
      .eq("note_id", noteId);
    if (error) {
      showToast("\u30d4\u30f3\u7559\u3081\u3092\u5909\u66f4\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f");
      return;
    }
    router.refresh();
  }

  return (
    <>
      {canShare && (
        <ShareButton
          title={article.title}
          text={`${article.title}\uFF5C\u30ce\u30fc\u30c8\u306e\u8a18\u4e8b`}
          path={`/notes/${noteId}/articles/${article.id}`}
          label={"\u3053\u306e\u8a18\u4e8b\u3092\u5171\u6709\u3059\u308b"}
        />
      )}
      {canEdit && (
        <ActionMenu
          onEdit={() => setEditing(true)}
          onPin={togglePin}
          pinned={article.pinned}
          onDelete={remove}
        deleteTitle="記事を削除しますか？"
        deleteDescription="削除した記事は元に戻せません。"
        />
      )}
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
