import * as React from "react";
import { cn } from "@/lib/utils";

/** 汎用ピル。色は style で渡す（ブロック色など） */
export function Badge({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none shrink-0",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}
