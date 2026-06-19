"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function Disclosure({
  title,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const expanded = open ?? internalOpen;

  function toggle() {
    const next = !expanded;
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }

  return (
    <div className={cn("border-t border-separator/70", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left active:opacity-60"
      >
        <span className="min-w-0 flex-1 text-headline">{title}</span>
        <ChevronDown
          size={18}
          className={cn(
            "shrink-0 text-muted transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && <div className="pb-3">{children}</div>}
    </div>
  );
}
