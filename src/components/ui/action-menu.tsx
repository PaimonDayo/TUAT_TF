"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Pin, PinOff, Quote, Share2, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function ActionMenu({
  onEdit,
  onQuote,
  onShare,
  onPin,
  onArchive,
  archived = false,
  pinned = false,
  onDelete,
  editLabel = "編集する",
  quoteLabel = "投稿を引用",
  shareLabel = "共有リンクをコピー",
  deleteLabel = "削除する",
  deleteTitle = "削除しますか？",
  deleteDescription = "削除した内容は元に戻せません。",
  triggerLabel = "操作メニュー",
  className,
}: {
  onEdit?: () => void;
  onQuote?: () => void;
  onShare?: () => void | Promise<void>;
  onDelete?: () => void | boolean | Promise<void | boolean>;
  onPin?: () => void | Promise<void>;
  onArchive?: () => void | Promise<void>;
  archived?: boolean;
  pinned?: boolean;
  editLabel?: string;
  quoteLabel?: string;
  shareLabel?: string;
  deleteLabel?: string;
  deleteTitle?: string;
  deleteDescription?: string;
  triggerLabel?: string;
  className?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function openForm(open?: () => void) {
    setMenuOpen(false);
    // このメニュー(Sheet=Radixダイアログ)が閉じるのと、編集フォーム(別のRadix
    // ダイアログ)が開くのが同じコミットで重なると、react-remove-scroll の
    // スクロールロックの受け渡しが競合する。iOS ではこの瞬間にロックが外れ、
    // 入力欄にフォーカスするとページがスクロールして入力欄がキーボードの
    // 裏（画面外）へ隠れる。Sheet を閉じ切ってから編集フォームを開く。
    window.setTimeout(() => open?.(), 220);
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
          "flex h-8 w-8 shrink-0 items-center justify-center text-muted pressable",
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
                onClick={() => openForm(onEdit)}
                className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3.5 active:bg-bg"
              >
                <Pencil size={20} className="text-accent" />
                <span className="text-headline">{editLabel}</span>
              </button>
            )}
            {onQuote && (
              <button
                type="button"
                onClick={() => openForm(onQuote)}
                className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3.5 active:bg-bg"
              >
                <Quote size={20} className="text-accent" />
                <span className="text-headline">{quoteLabel}</span>
              </button>
            )}
            {onShare && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void onShare();
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3.5 active:bg-bg"
              >
                <Share2 size={20} className="text-accent" />
                <span className="text-headline">{shareLabel}</span>
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
                <span className="text-headline">{pinned ? "ピン留めを外す" : "ピン留めする"}</span>
              </button>
            )}
            {onArchive && (
              <button type="button" onClick={() => { setMenuOpen(false); void onArchive(); }}
                className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3.5 active:bg-bg">
                {archived ? <ArchiveRestore size={20} className="text-accent" /> : <Archive size={20} className="text-accent" />}
                <span className="text-left"><span className="block text-headline">{archived ? "アーカイブを解除" : "アーカイブする"}</span><span className="block text-caption text-muted">{archived ? "ホームの表示対象に戻します" : "全員のホームから非表示にします"}</span></span>
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
