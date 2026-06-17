import * as React from "react";
import { cn } from "@/lib/utils";

/** iOS 風カード（白背景・角丸16px・薄ボーダー） */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[16px] bg-card border border-separator/70",
        className,
      )}
      {...props}
    />
  );
}

export function CardSection({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {label && <p className="section-label px-1">{label}</p>}
      {children}
    </div>
  );
}
