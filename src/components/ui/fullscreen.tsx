"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { syncVisualViewport } from "@/lib/viewport-sync";
import { useSystemGlass } from "@/components/layout/glass/system-glass-state";
import { glassDialogOpener } from "@/components/layout/glass/glass-press";

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
export function FullScreenContent({
  title,
  children,
  footer,
  autoFocus = true,
  className,
  floatingAction,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  autoFocus?: boolean;
  className?: string;
  floatingAction?: React.ReactNode;
}) {
  const systemGlass = useSystemGlass();
  const openerRef = React.useRef<HTMLElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const autoFocusFrame = React.useRef<number | undefined>(undefined);
  // Dialog.Portal mounts after its parent effect, and may open much later.
  // Attach on the actual DOM mount, including every reopen (React 19 ref cleanup).
  const attachContent = React.useCallback((element: HTMLDivElement | null) => {
    contentRef.current = element;
    if (!element) return;
    const detach = syncVisualViewport(element, "full");
    return () => {
      detach();
      if (autoFocusFrame.current !== undefined) cancelAnimationFrame(autoFocusFrame.current);
      autoFocusFrame.current = undefined;
      contentRef.current = null;
    };
  }, []);
  return (
    <Dialog.Portal>
      <Dialog.Overlay data-new-ui-surface={systemGlass || undefined} className="sheet-overlay fixed inset-0 z-50 bg-black/30">
        {/* visualViewport でフォーム本体が移動しても、ステータスバー領域を透かさない。 */}
        <div aria-hidden="true" className="h-full w-full bg-bg" />
      </Dialog.Overlay>
      <Dialog.Content
        data-new-ui-surface={systemGlass || undefined}
        ref={attachContent}
        onKeyDownCapture={(event) => {
          // このモーダルは Portal で描画されるが、React の合成イベントは
          // 「開いた元のカード」の React ツリーを通って伝播する。カードは
          // タップ／Enter で開閉する role="button" なので、入力欄で改行を
          // 押すとカードが閉じ、編集フォームごと消えてしまっていた。
          // 入力中のキー操作はここで止める（保存は明示的なボタンのみ）。
          // Escape（閉じる）と Tab（フォーカス移動）は Radix 側の処理を
          // 残すため素通しする。
          const target = event.target as HTMLElement | null;
          const typing =
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLInputElement ||
            target instanceof HTMLSelectElement ||
            target?.isContentEditable === true;
          if (typing && event.key !== "Escape" && event.key !== "Tab") {
            event.stopPropagation();
          }
        }}
        onOpenAutoFocus={(event) => {
          openerRef.current = glassDialogOpener();
          event.preventDefault();
          if (!autoFocus) {
            if (systemGlass) contentRef.current?.focus({ preventScroll: true });
            return;
          }

          // Avoid racing the initial focus with the mobile keyboard viewport resize.
          const content = contentRef.current;
          if (autoFocusFrame.current !== undefined) cancelAnimationFrame(autoFocusFrame.current);
          autoFocusFrame.current = requestAnimationFrame(() => {
            autoFocusFrame.current = undefined;
            if (!content || contentRef.current !== content) return;
            // A warmed form can be used immediately. Never pull focus away
            // from an input or button the user has already chosen this frame.
            if (document.activeElement !== content && content.contains(document.activeElement)) return;
            const target = content.querySelector<HTMLElement>(
              "textarea,input,select,[contenteditable='true']",
            );
            target?.focus({ preventScroll: true });
          });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (systemGlass && openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true });
        }}
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
          "fullscreen-content fixed inset-x-0 top-0 z-50 h-dvh w-full bg-bg flex flex-col outline-none",
          className,
        )}
      >
        {/* 新 UI の戻るはページと同じアイコンだけに揃え、閉じる処理は Dialog に任せる。 */}
        <div className={cn("h-12 shrink-0 box-content grid items-center border-b border-separator bg-bg px-2 pt-[env(safe-area-inset-top)]", systemGlass
          ? "grid-cols-[minmax(44px,1fr)_minmax(0,2fr)_minmax(44px,1fr)]"
          : "grid-cols-[1fr_auto_1fr]")}>
          <Dialog.Close
            aria-label="戻る"
            data-glass-control={systemGlass || undefined}
            data-system-glass={systemGlass || undefined}
            className={systemGlass
              ? "justify-self-start flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink pressable"
              : "justify-self-start h-9 pl-1 pr-2 flex items-center gap-0.5 text-accent pressable text-[15px]"}
          >
            <ChevronLeft size={24} aria-hidden="true" />
            {!systemGlass && "戻る"}
          </Dialog.Close>
          <Dialog.Title data-new-ui-title={systemGlass || undefined} className={cn("text-title text-center whitespace-nowrap", systemGlass && "min-w-0 truncate")} title={title}>{title}</Dialog.Title>
          <div />
        </div>

        {/* スクロール領域（高さ固定なので中身が変わっても外形は不変） */}
        <div className="flex-1 overflow-y-auto px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
          {children}
        </div>

        {floatingAction && <div className="absolute right-4 bottom-[max(env(safe-area-inset-bottom),16px)] z-20">{floatingAction}</div>}
        {footer && (
          <div className="shrink-0 border-t border-separator bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">
            {footer}
          </div>
        )}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
