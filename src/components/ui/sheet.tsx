"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

/**
 * 下からせり上がるボトムシート。
 * <Sheet open onOpenChange>...<SheetContent title>...</SheetContent></Sheet>
 */
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  title,
  children,
  className,
  bodyClassName,
  autoFocus = true,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** false にすると開いた瞬間に入力欄へフォーカスしない（キーボードが勝手に出ない） */
  autoFocus?: boolean;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-overlay fixed inset-0 z-50 bg-black/30" />
      <Dialog.Content
        onOpenAutoFocus={autoFocus ? undefined : (e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className={cn(
          "sheet-content fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-[20px] bg-bg pb-[max(env(safe-area-inset-bottom),16px)] outline-none",
          className,
        )}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="h-1 w-9 rounded-full bg-separator" />
        </div>
        {title && (
          <Dialog.Title className="text-title text-center pb-2 pt-1">
            {title}
          </Dialog.Title>
        )}
        {!title && <Dialog.Title className="sr-only">メニュー</Dialog.Title>}
        <div className={cn("px-4 pt-1", bodyClassName)}>{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
