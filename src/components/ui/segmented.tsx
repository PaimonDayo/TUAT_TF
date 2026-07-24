"use client";

import { cn } from "@/lib/utils";

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
  return (
    <div
      className={cn(
        // min-h を固定し、項目数や文字数で縦寸法が変わらないようにする
        "flex min-h-[34px] items-center gap-0.5 rounded-[10px] bg-[#e9e9eb] p-0.5 lg:min-h-8 lg:rounded-lg",
        className,
      )}
    >
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            className={cn(
              "flex-1 min-w-0 rounded-[8px] py-1.5 text-[13px] font-semibold transition-colors active:opacity-70 truncate px-1 lg:rounded-md lg:py-1 lg:text-[12px]",
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
