"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RecordForm } from "@/components/post/RecordForm";
import { TweetForm } from "@/components/post/TweetForm";
import type { PracticeRecord } from "@/types";

type Mode = "menu" | "edit";

function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="メニュー"
      className="h-8 w-8 -mr-1 flex items-center justify-center text-muted active:opacity-50 shrink-0"
    >
      <MoreHorizontal size={20} />
    </button>
  );
}

function DeleteAndEdit({
  onEdit,
  onDelete,
  deleting,
}: {
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div className="space-y-2 pb-4">
      <button
        onClick={onEdit}
        className="w-full flex items-center gap-3 rounded-xl bg-card border border-separator p-3.5 active:bg-bg"
      >
        <Pencil size={20} className="text-accent" />
        <span className="text-headline">編集する</span>
      </button>
      <button
        onClick={onDelete}
        disabled={deleting}
        className="w-full flex items-center gap-3 rounded-xl bg-card border border-separator p-3.5 active:bg-bg text-danger"
      >
        <Trash2 size={20} />
        <span className="text-headline">{deleting ? "削除中…" : "削除する"}</span>
      </button>
    </div>
  );
}

/** 練習記録の編集・削除メニュー（本人のみ表示） */
export function RecordOwnerMenu({
  record,
  isMiddleLong,
}: {
  record: PracticeRecord;
  isMiddleLong: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [deleting, setDeleting] = useState(false);

  async function del() {
    if (!confirm("この練習記録を削除しますか？")) return;
    setDeleting(true);
    const supabase = createClient();
    await supabase.from("practice_records").delete().eq("id", record.id);
    router.refresh();
    setOpen(false);
  }

  return (
    <>
      <MenuButton
        onClick={() => {
          setMode("menu");
          setOpen(true);
        }}
      />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title={mode === "edit" ? "練習記録を編集" : undefined}>
          {mode === "menu" ? (
            <DeleteAndEdit onEdit={() => setMode("edit")} onDelete={del} deleting={deleting} />
          ) : (
            <RecordForm
              userId={record.user_id}
              isMiddleLong={isMiddleLong}
              record={record}
              onDone={() => setOpen(false)}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** つぶやきの編集・削除メニュー（本人のみ表示） */
export function TweetOwnerMenu({ tweet }: { tweet: { id: string; content: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [deleting, setDeleting] = useState(false);

  async function del() {
    if (!confirm("このつぶやきを削除しますか？")) return;
    setDeleting(true);
    const supabase = createClient();
    await supabase.from("tweets").delete().eq("id", tweet.id);
    router.refresh();
    setOpen(false);
  }

  return (
    <>
      <MenuButton
        onClick={() => {
          setMode("menu");
          setOpen(true);
        }}
      />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title={mode === "edit" ? "つぶやきを編集" : undefined}>
          {mode === "menu" ? (
            <DeleteAndEdit onEdit={() => setMode("edit")} onDelete={del} deleting={deleting} />
          ) : (
            <TweetForm tweet={tweet} onDone={() => setOpen(false)} />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
