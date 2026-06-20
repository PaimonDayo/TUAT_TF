"use client";

import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * 学年フィルター（iOS風プルダウン）。ボタンを押すとチェックリストが出て複数選択できる。
 * 空配列＝全学年。選択状態は色だけで示し（フォロー/簡易トグルと同様）、ボタンの幅は一切変わらない。
 */
export function GradeMenu({
  value,
  onChange,
  availableGrades,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  /** 指定すると、この学年（値）だけを選択肢に出す（在籍者がいる学年のみ表示する用途） */
  availableGrades?: string[];
}) {
  const [open, setOpen] = useState(false);
  const active = value.length > 0;
  const options = availableGrades
    ? GRADE_OPTIONS.filter((g) => availableGrades.includes(g.value))
    : GRADE_OPTIONS;

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((g) => g !== v) : [...value, v]);
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="学年でしぼり込み"
        className={cn(
          "h-8 rounded-full border pl-3 pr-2 text-[13px] font-semibold inline-flex items-center gap-1 active:opacity-60",
          active ? "bg-accent text-white border-accent" : "bg-card border-separator text-muted2",
        )}
      >
        学年
        <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          {/* 外側タップで閉じる */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-40 max-h-[60vh] overflow-y-auto rounded-2xl border border-separator bg-card py-1 shadow-lg">
            <MenuRow label="すべて" checked={value.length === 0} onClick={() => onChange([])} />
            <div className="my-1 border-t border-separator" />
            {options.map((g) => (
              <MenuRow
                key={g.value}
                label={g.short}
                checked={value.includes(g.value)}
                onClick={() => toggle(g.value)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MenuRow({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[14px] active:bg-bg"
    >
      <span className={cn(checked ? "font-semibold text-ink" : "text-muted2")}>{label}</span>
      {checked && <Check size={16} className="shrink-0 text-accent" />}
    </button>
  );
}
