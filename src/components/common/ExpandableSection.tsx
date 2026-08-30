"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 長い投稿だけを一定の高さで畳み、「続きを読む」で全文を出す。
 * 収まっている投稿にはボタンを出さないので、短いつぶやきはそのまま全文が見える。
 */
export function ExpandableSection({
  maxHeight = 140,
  forceExpanded = false,
  className,
  children,
}: {
  maxHeight?: number;
  /** 一覧行を展開したカードなど、外側ですでに全文表示を選んでいる場合に使う。 */
  forceExpanded?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    // 畳んでいる間も scrollHeight は全文の高さを返すので、そのまま比較できる。
    // 画像の読み込みやフォント切替で高さが変わるため ResizeObserver で測り直す。
    const measure = () => setOverflowing(node.scrollHeight > maxHeight + 8);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [maxHeight]);

  const collapsed = !forceExpanded && overflowing && !expanded;

  return (
    <div className={className}>
      <div className="relative">
        <div
          ref={contentRef}
          className={cn(collapsed && "overflow-hidden")}
          style={collapsed ? { maxHeight } : undefined}
        >
          {children}
        </div>
        {collapsed && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-card"
          />
        )}
      </div>
      {!forceExpanded && overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="mt-1 text-[12px] font-semibold text-accent active:opacity-60"
        >
          {expanded ? "閉じる" : "続きを読む"}
        </button>
      )}
    </div>
  );
}
