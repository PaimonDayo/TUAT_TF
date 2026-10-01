"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, type CSSProperties } from "react";
import { useSystemGlass } from "@/components/layout/glass/system-glass-state";
import { attachSegmentInteraction } from "@/components/layout/glass/segment-interaction";

/** iOS 風セグメントコントロール（フィルタタブ用） */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  const systemGlass = useSystemGlass();
  const selectedIndex = items.findIndex((item) => item.key === value);
  const rootRef = useRef<HTMLDivElement>(null);
  const motion = useRef<ReturnType<typeof attachSegmentInteraction> | null>(null);
  const selection = useRef(selectedIndex);
  const keys = JSON.stringify(items.map((item) => item.key));
  useEffect(() => {
    selection.current = selectedIndex;
    motion.current?.update(selectedIndex);
  }, [selectedIndex]);
  useEffect(() => {
    if (!systemGlass || !rootRef.current || items.length === 0) return;
    motion.current = attachSegmentInteraction(rootRef.current, selection.current);
    return () => { motion.current?.destroy(); motion.current = null; };
  }, [systemGlass, keys, items.length]);
  return (
    <div
      ref={rootRef}
      data-glass-segments
      data-system-glass={systemGlass || undefined}
      className={cn(
        // min-h を固定し、項目数や文字数で縦寸法が変わらないようにする
        "flex min-h-[34px] items-center gap-0.5 rounded-[10px] bg-[#e9e9eb] p-0.5 lg:min-h-8 lg:rounded-lg",
        className,
      )}
    >
      {systemGlass && items.length > 0 && <span data-glass-selection aria-hidden="true" style={{
        // Equal columns, 2px gaps and 2px insets. CSS keeps fractional positions
        // in sync during resizing and dialog animation without DOM measurement.
        width: `calc((100% - 2px) / ${items.length} - 2px)`,
        "--glass-selection-left": `calc(2px + (100% - 2px) / ${items.length} * ${Math.max(0, selectedIndex)})`,
        visibility: selectedIndex < 0 ? "hidden" : undefined,
      } as CSSProperties} />}
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(it.key)}
            className={cn(
              "flex-1 min-w-0 rounded-[8px] py-1.5 text-[13px] font-semibold transition-colors pressable truncate px-1 lg:rounded-md lg:py-1 lg:text-[12px]",
              active ? "bg-white text-ink shadow-sm" : "text-muted2",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
