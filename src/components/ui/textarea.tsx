import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-xl bg-card border border-separator px-3 py-2.5 text-[15px] text-ink placeholder:text-muted outline-none focus:border-accent transition-colors resize-none",
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";
