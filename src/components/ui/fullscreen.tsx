"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 全画面モーダル。高さが固定なので、中身の量が変わっても
 * ボトムシートのように下からの伸縮でガクつかない。
 */
export const FullScreen = Dialog.Root;

export function FullScreenContent({
  title,
  children,
  footer,
  autoFocus = true,
  className,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-overlay fixed inset-0 z-50 bg-black/30" />
      <Dialog.Content
        onOpenAutoFocus={autoFocus ? undefined : (e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className={cn(
          "sheet-content fixed inset-0 z-50 mx-auto w-full max-w-md bg-bg flex flex-col outline-none",
          className,
        )}
      >
        {/* 固定ヘッダー */}
        <div className="h-12 px-2 flex items-center justify-between border-b border-separator shrink-0 pt-[env(safe-area-inset-top)] box-content">
          <Dialog.Close
            aria-label="閉じる"
            className="h-9 w-9 flex items-center justify-center text-muted active:opacity-50"
          >
            <X size={22} />
          </Dialog.Close>
          <Dialog.Title className="text-title">{title}</Dialog.Title>
          <div className="w-9" />
        </div>

        {/* スクロール領域（高さ固定なので中身が変わっても外形は不変） */}
        <div className="flex-1 overflow-y-auto px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-separator bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">
            {footer}
          </div>
        )}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
