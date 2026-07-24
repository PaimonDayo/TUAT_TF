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
  swipeToClose = false,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** false にすると開いた瞬間に入力欄へフォーカスしない（キーボードが勝手に出ない） */
  autoFocus?: boolean;
  /** 上部のハンドルを下へドラッグして閉じる。背の高いシート向け。 */
  swipeToClose?: boolean;
}) {
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const dragRef = React.useRef<{ startY: number; startedAt: number; offset: number } | null>(null);
  const resetTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  function snapBack() {
    const content = contentRef.current;
    if (!content) return;
    content.style.transition = "transform 180ms cubic-bezier(0.32, 0.72, 0, 1)";
    content.style.transform = "translateY(0)";
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      content.style.transition = "";
      content.style.transform = "";
    }, 180);
  }

  function finishDrag(event: React.PointerEvent<HTMLDivElement>, canceled = false) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const content = contentRef.current;
    if (!content) return;
    const elapsed = Math.max(Date.now() - drag.startedAt, 1);
    const fast = drag.offset > 32 && drag.offset / elapsed > 0.55;
    const far = drag.offset > Math.min(120, content.clientHeight * 0.18);
    if (!canceled && (far || fast)) {
      content.style.transition = "transform 160ms cubic-bezier(0.32, 0.72, 0, 1)";
      content.style.transform = "translateY(100%)";
      resetTimerRef.current = window.setTimeout(() => closeButtonRef.current?.click(), 140);
      return;
    }
    snapBack();
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!swipeToClose || event.button !== 0) return;
    const content = contentRef.current;
    if (!content) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    content.style.animation = "none";
    content.style.transition = "none";
    dragRef.current = { startY: event.clientY, startedAt: Date.now(), offset: 0 };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const offset = Math.max(0, event.clientY - drag.startY);
    drag.offset = offset;
    const content = contentRef.current;
    if (content) content.style.transform = `translateY(${offset}px)`;
  }
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-overlay fixed inset-0 z-50 bg-black/30" />
      <Dialog.Content
        ref={contentRef}
        onOpenAutoFocus={autoFocus ? undefined : (e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className={cn(
          "sheet-content fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-[20px] bg-bg pb-[max(env(safe-area-inset-bottom),16px)] outline-none",
          className,
        )}
      >
        <Dialog.Close asChild>
          <button ref={closeButtonRef} type="button" tabIndex={-1} aria-hidden="true" className="hidden" />
        </Dialog.Close>
        <div
          className={cn(
            "flex min-h-10 select-none items-center justify-center",
            swipeToClose && "touch-none cursor-grab active:cursor-grabbing",
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishDrag(event)}
          onPointerCancel={(event) => finishDrag(event, true)}
        >
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
