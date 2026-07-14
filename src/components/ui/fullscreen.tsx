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

/**
 * ソフトキーボード対策: visualViewport の高さ/位置に全画面フォームを追従させる。
 * React の再レンダリングを介さず ref に直接スタイルを当て、resize/scroll の
 * 連続イベントは requestAnimationFrame で 1フレーム1回に間引く。
 * （以前は useSyncExternalStore で毎イベント再描画していたため、キーボードの
 *   開閉アニメに追従しきれず「ぐらつき」が出ていた）
 */
function useViewportSync(ref: React.RefObject<HTMLDivElement | null>) {
  React.useEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el || !vv) return;

    let raf = 0;
    const apply = () => {
      raf = 0;
      el.style.height = `${vv.height}px`;
      el.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : "";
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      if (raf) cancelAnimationFrame(raf);
      el.style.height = "";
      el.style.transform = "";
    };
  }, [ref]);
}

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
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  useViewportSync(contentRef);
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-overlay fixed inset-0 z-50 bg-black/30" />
      <Dialog.Content
        ref={contentRef}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (!autoFocus) return;

          // Avoid racing the initial focus with the mobile keyboard viewport resize.
          requestAnimationFrame(() => {
            const target = contentRef.current?.querySelector<HTMLElement>(
              "textarea,input,select,[contenteditable='true']",
            );
            target?.focus({ preventScroll: true });
          });
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Select 等の Radix ポップアップや、入れ子の Sheet（Dialog.Root）は
        // Portal で Dialog 外（document.body直下）に描画されるため、その操作を
        // 「外側クリック」と誤判定してこのモーダルごと閉じてしまうのを防ぐ。
        // 例: RecordFieldsSetting の「追加する」Sheetを押すと保存前にモーダルが
        //     閉じてしまう不具合（role="dialog"のSheetがこの判定に含まれていなかった）。
        onPointerDownOutside={(e) => {
          const target = e.target as Element | null;
          if (
            target?.closest?.(
              "[data-radix-popper-content-wrapper],[data-radix-select-viewport],[role='listbox'],[role='dialog']",
            )
          ) {
            e.preventDefault();
          }
        }}
        className={cn(
          // 既定は dvh で全画面。キーボード表示時は viewportStyle が高さを上書きし、
          // ヘッダー(閉じる)・スクロール領域・フッター(投稿)を可視領域内に収める。
          "sheet-content fixed inset-x-0 top-0 z-50 mx-auto h-dvh w-full max-w-md bg-bg flex flex-col outline-none",
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
