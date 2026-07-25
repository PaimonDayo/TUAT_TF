"use client";

import { useState, type ReactNode } from "react";
import { Linkify } from "@/components/common/Linkify";
import { cn } from "@/lib/utils";

export function KeyValue({
  label,
  value,
  className,
  collapsible = false,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (value === null || value === undefined || value === "") return null;

  return (
    <div className={cn("grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-1", className)}>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-[13px]">
        <div className={cn("whitespace-pre-wrap", collapsible && !expanded && "line-clamp-3")}>
          {typeof value === "string" ? <Linkify text={value} /> : value}
        </div>
        {collapsible && typeof value === "string" && value.length > 90 && <button type="button" onClick={() => setExpanded((current) => !current)} className="mt-1 text-caption font-semibold text-accent">{expanded ? "閉じる" : "続きを読む"}</button>}
      </dd>
    </div>
  );
}