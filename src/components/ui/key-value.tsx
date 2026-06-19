import type { ReactNode } from "react";
import { Linkify } from "@/components/common/Linkify";
import { cn } from "@/lib/utils";

export function KeyValue({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  if (value === null || value === undefined || value === "") return null;

  return (
    <div className={cn("grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-1", className)}>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-[13px]">
        {typeof value === "string" ? <Linkify text={value} /> : value}
      </dd>
    </div>
  );
}
