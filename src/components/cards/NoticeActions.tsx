"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { NoticeForm } from "@/components/post/NoticeForm";
import type { Notice } from "@/types";

/** お知らせの編集・削除（お知らせ作成権限のある人に表示） */
export function NoticeActions({ notice }: { notice: Notice }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm("このお知らせを削除しますか？")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("notices").delete().eq("id", notice.id);
    if (error) {
      alert("削除に失敗しました");
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setEditing(true)}
        aria-label="編集"
        className="h-7 w-7 flex items-center justify-center text-muted active:text-accent"
      >
        <Pencil size={15} />
      </button>
      <button
        onClick={remove}
        disabled={busy}
        aria-label="削除"
        className="h-7 w-7 flex items-center justify-center text-muted active:text-danger disabled:opacity-40"
      >
        <Trash2 size={16} />
      </button>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent title="お知らせを編集">
          <NoticeForm initial={notice} onDone={() => setEditing(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
