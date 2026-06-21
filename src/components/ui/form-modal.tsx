"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { FullScreen, FullScreenContent } from "@/components/ui/fullscreen";

const FormModalFooterContext =
  createContext<Dispatch<SetStateAction<ReactNode | null>> | null>(null);

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
  const [registeredFooter, setRegisteredFooter] = useState<ReactNode | null>(null);

  return (
    <FullScreen open={open} onOpenChange={onOpenChange}>
      <FullScreenContent
        title={title}
        footer={footer ?? registeredFooter}
        autoFocus={autoFocus}
      >
        <FormModalFooterContext.Provider value={setRegisteredFooter}>
          {children}
        </FormModalFooterContext.Provider>
      </FullScreenContent>
    </FullScreen>
  );
}

/** 子フォームの送信操作を FormModal の固定フッターへ配置する。 */
export function FormModalFooter({ children }: { children: ReactNode }) {
  const setFooter = useContext(FormModalFooterContext);

  useEffect(() => {
    if (!setFooter) return;
    setFooter(children);
    return () => setFooter(null);
  }, [children, setFooter]);

  return setFooter ? null : children;
}
