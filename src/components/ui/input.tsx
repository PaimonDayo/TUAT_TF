import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl bg-card border border-separator px-3 text-[15px] text-ink placeholder:text-muted outline-none focus:border-accent transition-colors",
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";
