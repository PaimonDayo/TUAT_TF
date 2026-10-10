import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      data-ui-field
      className={cn(
        // text-base(16px) は必須: iOS Safari は16px未満の入力欄にフォーカスすると自動ズーム→画面がガクつくため
        "h-11 w-full min-w-0 rounded-xl bg-card border border-separator px-3 text-base text-ink placeholder:text-muted outline-none focus:border-accent transition-colors lg:h-9 lg:rounded-lg lg:text-[14px]",
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";
