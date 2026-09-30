"use client";

import { cn } from "@/lib/utils";
import { useLayoutEffect, useRef } from "react";
import { useSystemGlass } from "@/components/layout/glass/system-glass-state";

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
  const track = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = track.current;
    if (!systemGlass || !node) return;
    const update = () => {
      const selected = node.querySelector<HTMLElement>('button[aria-pressed="true"]');
      const lens = node.querySelector<HTMLElement>("[data-glass-selection]");
      if (!selected || !lens) return;
      lens.style.width = `${selected.offsetWidth}px`;
      lens.style.transform = `translateX(${selected.offsetLeft}px)`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [systemGlass, value, items]);
  return (
    <div
      ref={track}
      data-glass-segments
      className={cn(
        // min-h を固定し、項目数や文字数で縦寸法が変わらないようにする
        "flex min-h-[34px] items-center gap-0.5 rounded-[10px] bg-[#e9e9eb] p-0.5 lg:min-h-8 lg:rounded-lg",
        className,
      )}
    >
      {systemGlass && <span data-glass-selection aria-hidden="true" />}
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
