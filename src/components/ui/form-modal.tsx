"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type RefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { FullScreen, FullScreenContent } from "@/components/ui/fullscreen";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";

type DraftState = { dirty: boolean; busy: boolean; onSave: () => void | Promise<void> };
const FormDraftContext = createContext<RefObject<DraftState | null> | null>(null);

/** 子フォームの変更・保存状態を親の閉じる操作へ伝える。 */
export function useFormDraft(state: DraftState) {
  const guardRef = useContext(FormDraftContext);
  useEffect(() => {
    if (!guardRef) return;
    guardRef.current = state;
    return () => { guardRef.current = null; };
  }, [guardRef, state]);
}
export function FormDraftGuard(props: DraftState) {
  useFormDraft(props);
  return null;
}

type FooterContextValue = {
  target: HTMLDivElement | null;
  register: () => () => void;
};

const FormModalFooterContext = createContext<FooterContextValue | null>(null);

export function FormModal({
  open,
  onOpenChange,
  title,
  children,
  footer,
  autoFocus = true,
  floatingAction,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  autoFocus?: boolean;
  floatingAction?: ReactNode;
  wide?: boolean;
}) {
  const draft = useRef<DraftState | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  function requestOpenChange(next: boolean) {
    if (!next && draft.current?.busy) return;
    if (!next && draft.current?.dirty) { setConfirmClose(true); return; }
    onOpenChange(next);
  }
  const [footerCount, setFooterCount] = useState(0);
  const [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null);
  const context = useMemo<FooterContextValue>(
    () => ({
      target: footerTarget,
      register: () => {
        setFooterCount((count) => count + 1);
        return () => setFooterCount((count) => Math.max(0, count - 1));
      },
    }),
    [footerTarget],
  );
  const footerHost =
    footer ??
    (footerCount > 0 ? <div ref={setFooterTarget} className="w-full" /> : undefined);

  return (
    <>
    <FullScreen open={open} onOpenChange={requestOpenChange}>
      <FullScreenContent
        title={title}
        footer={footerHost}
        autoFocus={autoFocus}
        floatingAction={floatingAction}
        className={wide ? "md:max-w-5xl" : undefined}
      >
        <FormModalFooterContext.Provider value={context}>
          <FormDraftContext.Provider value={draft}>
            {children}
          </FormDraftContext.Provider>
        </FormModalFooterContext.Provider>
      </FullScreenContent>
    </FullScreen>
    <UnsavedChangesDialog open={open && confirmClose} busy={false}
      onContinue={() => setConfirmClose(false)}
      onDiscard={() => { if (draft.current?.busy) return; setConfirmClose(false); onOpenChange(false); }}
      onSave={() => { if (draft.current?.busy) return; setConfirmClose(false); void draft.current?.onSave(); }} />
    </>
  );
}

/** 子フォームの送信操作を FormModal の固定フッターへ配置する。 */
export function FormModalFooter({ children }: { children: ReactNode }) {
  const context = useContext(FormModalFooterContext);

  useEffect(() => {
    if (!context) return;
    return context.register();
  }, [context]);

  if (!context) return children;
  return context.target ? createPortal(children, context.target) : null;
}
