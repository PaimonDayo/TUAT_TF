"use client";

import { useState } from "react";
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
