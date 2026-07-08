"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu } from "@/components/ui/action-menu";
import { FormModal } from "@/components/ui/form-modal";
import { RecordForm } from "@/components/post/RecordForm";
import { TweetForm } from "@/components/post/TweetForm";
import { useToast } from "@/components/ui/toast";
import type { PracticeRecord } from "@/types";

/** 練習記録の編集・削除メニュー（本人のみ表示） */
export function RecordOwnerMenu({
  record,
  isMiddleLong,
  recordSource = "app",
}: {
  record: PracticeRecord;
  isMiddleLong: boolean;
  /** 記録のメイン。'sheet'ならスプシ由来(from_sheet)の記録も編集可（write-through） */
  recordSource?: "app" | "sheet";
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  // 記録のメインがアプリの部員は、スプシ由来(from_sheet)の記録はアプリ内では編集不可
  // （そちらは今もスプシ側が正）。メインがスプシの部員はどちらの記録も編集可（write-through）。
  const editable = recordSource === "sheet" || !record.from_sheet;

  async function remove() {
    const supabase = createClient();
    const { error } = await supabase.from("practice_records").delete().eq("id", record.id);
    if (error) {
      showToast("練習記録を削除できませんでした");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <ActionMenu
        onEdit={editable ? () => setEditOpen(true) : undefined}
        onDelete={editable ? remove : undefined}
        deleteTitle="練習記録を削除しますか？"
        deleteDescription="削除した練習記録は元に戻せません。"
        triggerLabel="練習記録のメニュー"
        className="-mr-1"
      />
      <FormModal open={editOpen} onOpenChange={setEditOpen} title="練習記録を編集">
        <RecordForm
          userId={record.user_id}
          isMiddleLong={isMiddleLong}
          record={record}
          recordSource={recordSource}
          onDone={() => setEditOpen(false)}
        />
      </FormModal>
    </>
  );
}

/** つぶやきの編集・削除メニュー（本人のみ表示） */
export function TweetOwnerMenu({ tweet }: { tweet: { id: string; content: string } }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editOpen, setEditOpen] = useState(false);

  async function remove() {
    const supabase = createClient();
    const { error } = await supabase.from("tweets").delete().eq("id", tweet.id);
    if (error) {
      showToast("つぶやきを削除できませんでした");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <ActionMenu
        onEdit={() => setEditOpen(true)}
        onDelete={remove}
        deleteTitle="つぶやきを削除しますか？"
        deleteDescription="削除したつぶやきは元に戻せません。"
        triggerLabel="つぶやきのメニュー"
        className="-mr-1"
      />
      <FormModal open={editOpen} onOpenChange={setEditOpen} title="つぶやきを編集">
        <TweetForm tweet={tweet} onDone={() => setEditOpen(false)} />
      </FormModal>
    </>
  );
}
