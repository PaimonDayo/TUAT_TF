"use client";

import { X } from "lucide-react";
import { GRADE_OPTIONS } from "@/lib/constants";

/**
 * 適用中の学年フィルタを「外せる固定幅チップ」で表示する。
 * 幅は一定（w-14 + tabular-nums）で、選択の増減や桁でガクつかない。
 */
export function GradeChips({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  if (value.length === 0) return null;
  const ordered = GRADE_OPTIONS.filter((g) => value.includes(g.value));

  return (
    <div className="flex flex-wrap gap-1.5">
      {ordered.map((g) => (
        <button
          key={g.value}
          type="button"
          onClick={() => onChange(value.filter((x) => x !== g.value))}
          aria-label={`${g.short} の絞り込みを外す`}
          className="inline-flex h-7 w-14 items-center justify-center gap-1 rounded-full bg-accent/10 text-[12px] font-semibold tabular-nums text-accent active:opacity-60"
        >
          {g.short}
          <X size={12} className="shrink-0" />
        </button>
      ))}
    </div>
  );
}
