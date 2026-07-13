"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function ActionMenu({
  onEdit,
  onPin,
  pinned = false,
  onDelete,
  editLabel = "編集する",
  deleteLabel = "削除する",
  deleteTitle = "削除しますか？",
  deleteDescription = "削除した内容は元に戻せません。",
  triggerLabel = "操作メニュー",
  className,
}: {
  onEdit?: () => void;
  onDelete?: () => void | boolean | Promise<void | boolean>;
  onPin?: () => void | Promise<void>;
  pinned?: boolean;
  editLabel?: string;
  deleteLabel?: string;
  deleteTitle?: string;
  deleteDescription?: string;
  triggerLabel?: string;
  className?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function edit() {
    setMenuOpen(false);
    // このメニュー(Sheet=Radixダイアログ)が閉じるのと、編集フォーム(別のRadix
    // ダイアログ)が開くのが同じコミットで重なると、react-remove-scroll の
    // スクロールロックの受け渡しが競合する。iOS ではこの瞬間にロックが外れ、
    // 入力欄にフォーカスするとページがスクロールして入力欄がキーボードの
    // 裏（画面外）へ隠れる。Sheet を閉じ切ってから編集フォームを開く。
    window.setTimeout(() => onEdit?.(), 220);
  }

  async function remove() {
    if (!onDelete || deleting) return;
    setDeleting(true);
    try {
      const deleted = await onDelete();
      if (deleted !== false) setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label={triggerLabel}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center text-muted active:opacity-50",
          className,
        )}
      >
        <MoreHorizontal size={20} />
      </button>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent>
          <div className="space-y-2 pb-4">
            {onEdit && (
              <button
                type="button"
                onClick={edit}
                className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3.5 active:bg-bg"
              >
                <Pencil size={20} className="text-accent" />
                <span className="text-headline">{editLabel}</span>
              </button>
            )}
            {onPin && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void onPin();
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3.5 active:bg-bg"
              >
                {pinned ? <PinOff size={20} className="text-accent" /> : <Pin size={20} className="text-accent" />}
                <span className="text-headline">{pinned ? "\u30d4\u30f3\u7559\u3081\u3092\u5916\u3059" : "\u30d4\u30f3\u7559\u3081\u3059\u308b"}</span>
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmOpen(true);
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3.5 text-danger active:bg-bg"
              >
                <Trash2 size={20} />
                <span className="text-headline">{deleteLabel}</span>
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={deleteTitle}
        description={deleteDescription}
        confirmLabel={deleteLabel}
        busy={deleting}
        onConfirm={remove}
      />
    </>
  );
}
