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
        // text-base(16px) は必須: iOS Safari は16px未満の入力欄にフォーカスすると自動ズーム→画面がガクつくため
        "w-full rounded-xl bg-card border border-separator px-3 py-2.5 text-base text-ink placeholder:text-muted outline-none focus:border-accent transition-colors resize-none",
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";
