"use client";

import { GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * 学年フィルター。固定サイズのチップを横スクロールで並べ、
 * 複数学年を選択できる。空配列は全学年を表す。
 */
export function GradeChips({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((g) => g !== v) : [...value, v]);
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <div className="flex w-max gap-1.5">
        <Chip label="全学年" active={value.length === 0} onClick={() => onChange([])} />
        {GRADE_OPTIONS.map((grade) => (
          <Chip
            key={grade.value}
            label={grade.short}
            active={value.includes(grade.value)}
            onClick={() => toggle(grade.value)}
          />
        ))}
      </div>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold transition-active active:opacity-60",
        active ? "border-accent bg-accent text-white" : "border-separator bg-card text-muted2",
      )}
    >
      {label}
    </button>
  );
}
