"use client";

import type { ReactNode } from "react";
import { FullScreen, FullScreenContent } from "@/components/ui/fullscreen";

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
  return (
    <FullScreen open={open} onOpenChange={onOpenChange}>
      <FullScreenContent title={title} footer={footer} autoFocus={autoFocus}>
        {children}
      </FullScreenContent>
    </FullScreen>
  );
}
