"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionMenu } from "@/components/ui/action-menu";
import { FormModal } from "@/components/ui/form-modal";
import { NoteEditor } from "@/components/features/NoteEditor";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import type { AuthorMini, NoteWithRelations } from "@/types";

/**
 * フォルダ一覧の行に付く⋯メニュー（編集/削除）。
 * 記事行（NoteArticleActions）と同じ導線をフォルダにも用意する
 * （2026-07-13 オーナー指摘「編集をどこでやればいいかわからない」対応。
 * フォルダを開いた先の右上⋯も従来どおり使える）。
 */
export function FolderRowActions({
  note,
  currentUser,
  isAdmin,
}: {
  note: NoteWithRelations;
  currentUser: AuthorMini;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [members, setMembers] = useState<AuthorMini[] | null>(null);

  async function openEdit() {
    setEditing(true);
    if (members) return;
    const { data } = await createClient()
      .from("profiles")
      .select("id, display_name, avatar_url, blocks, grade")
      .eq("status", "active")
      .order("display_name", { ascending: true });
    setMembers((data ?? []) as AuthorMini[]);
  }

  async function remove() {
    const { error } = await createClient().from("notes").delete().eq("id", note.id);
    if (error) {
      showToast("フォルダを削除できませんでした");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <ActionMenu
        onEdit={() => void openEdit()}
        onDelete={remove}
        deleteTitle="フォルダを削除しますか？"
        deleteDescription="フォルダ内のサブフォルダ・記事もすべて削除され、元に戻せません。"
      />
      {editing && (
        <FormModal open onOpenChange={setEditing} title="フォルダ設定を編集">
          {members ? (
            <NoteEditor
              currentUser={currentUser}
              members={members}
              note={note}
              isAdmin={isAdmin}
              initialScope={note.scope}
              onDone={() => setEditing(false)}
            />
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
        </FormModal>
      )}
    </>
  );
}
