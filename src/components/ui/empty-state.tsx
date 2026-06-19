import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-32 flex-col items-center justify-center px-4 py-8 text-center",
        className,
      )}
    >
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="text-headline">{title}</p>
      {description && <p className="mt-1 max-w-xs text-caption">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
