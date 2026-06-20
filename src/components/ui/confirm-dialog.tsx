"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "削除する",
  busyLabel = "削除中…",
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-[60] bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[18px] bg-card p-5 shadow-xl outline-none">
          <Dialog.Title className="text-title">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-[14px] text-muted2">
            {description}
          </Dialog.Description>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" disabled={busy}>
                キャンセル
              </Button>
            </Dialog.Close>
            <Button type="button" variant="danger" disabled={busy} onClick={onConfirm}>
              {busy ? busyLabel : confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
