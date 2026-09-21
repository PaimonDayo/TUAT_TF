"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu } from "@/components/ui/action-menu";
import { FormModal } from "@/components/ui/form-modal";
import { NoticeForm } from "@/components/post/NoticeForm";
import { useToast } from "@/components/ui/toast";
import type { Notice } from "@/types";

/** お知らせの編集・削除（お知らせ作成権限のある人に表示） */
export function NoticeActions({ notice }: { notice: Notice }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const archiving = useRef(false);

  async function toggleArchive() {
    if (archiving.current) return;
    archiving.current = true;
    try {
      const { data, error } = await createClient().from("notices")
        .update({ archived_at: notice.archived_at ? null : new Date().toISOString() })
        .eq("id", notice.id).select("id");
      if (error || data?.length !== 1) throw new Error("Archive failed");
      showToast(notice.archived_at ? "アーカイブを解除しました" : "アーカイブしました");
      router.refresh();
    } catch {
      showToast("アーカイブの状態を変更できませんでした");
    } finally {
      archiving.current = false;
    }
  }

  async function remove() {
    const supabase = createClient();
    const { data, error } = await supabase.from("notices").delete().eq("id", notice.id).select("id");
    if (error || !data || data.length !== 1) {
      showToast("お知らせを削除できませんでした");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <ActionMenu
        onEdit={() => setEditing(true)}
        onArchive={toggleArchive}
        archived={!!notice.archived_at}
        onDelete={remove}
        deleteTitle="お知らせを削除しますか？"
        deleteDescription="削除したお知らせは元に戻せません。"
        triggerLabel="お知らせのメニュー"
      />
      {editing && (
        <FormModal open onOpenChange={setEditing} title="お知らせを編集">
          <NoticeForm initial={notice} onDone={() => setEditing(false)} />
        </FormModal>
      )}
    </>
  );
}
