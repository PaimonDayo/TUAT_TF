"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";

export function UnsavedChangesDialog({ open, busy, onContinue, onDiscard, onSave }: { open: boolean; busy: boolean; onContinue: () => void; onDiscard: () => void; onSave: () => void }) {
  return <Dialog.Root open={open} onOpenChange={(next) => !next && !busy && onContinue()}>
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-overlay fixed inset-0 z-[60] bg-black/30" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[18px] bg-card p-5 shadow-xl outline-none">
        <Dialog.Title className="text-title">変更を保存しますか？</Dialog.Title>
        <Dialog.Description className="mt-2 text-[14px] text-muted2">保存していない入力があります。閉じる前に保存できます。</Dialog.Description>
        <div className="mt-5 space-y-2">
          <Button type="button" className="w-full" disabled={busy} onClick={onSave}>{busy ? "保存中…" : "保存して閉じる"}</Button>
          <Button type="button" variant="outline" className="w-full text-danger" disabled={busy} onClick={onDiscard}>変更を破棄して閉じる</Button>
          <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={onContinue}>編集を続ける</Button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}