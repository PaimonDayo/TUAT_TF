"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { FullScreen, FullScreenContent } from "@/components/ui/fullscreen";

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  autoFocus?: boolean;
}) {
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
    <FullScreen open={open} onOpenChange={onOpenChange}>
      <FullScreenContent
        title={title}
        footer={footerHost}
        autoFocus={autoFocus}
      >
        <FormModalFooterContext.Provider value={context}>
          {children}
        </FormModalFooterContext.Provider>
      </FullScreenContent>
    </FullScreen>
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
