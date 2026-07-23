import * as React from "react";
import { cn } from "@/lib/utils";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** 入力内容に合わせて高さを伸ばし、入力欄内の縦スクロールをなくす。 */
  autoGrow?: boolean;
};

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  TextareaProps
>(({ autoGrow = false, className, onInput, style, value, ...props }, forwardedRef) => {
  const localRef = React.useRef<HTMLTextAreaElement | null>(null);

  const setRef = React.useCallback((node: HTMLTextAreaElement | null) => {
    localRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const resizeToContent = React.useCallback(() => {
    const element = localRef.current;
    if (!autoGrow || !element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [autoGrow]);

  React.useLayoutEffect(() => {
    resizeToContent();
  }, [resizeToContent, value]);
  return (
    <textarea
      ref={setRef}
      className={cn(
        // text-base(16px) は必須: iOS Safari は16px未満の入力欄にフォーカスすると自動ズーム→画面がガクつくため
        "w-full rounded-xl bg-card border border-separator px-3 py-2.5 text-base text-ink placeholder:text-muted outline-none focus:border-accent transition-colors resize-none",
        autoGrow && "overflow-y-hidden",
        className,
      )}
      style={style}
      value={value}
      onInput={(event) => {
        resizeToContent();
        onInput?.(event);
      }}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";
