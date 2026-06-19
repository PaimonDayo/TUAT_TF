"use client";

import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * 学年フィルター（iOS風プルダウン）。ボタンを押すとチェックリストが出て複数選択できる。
 * 空配列＝全学年。選択中はボタンに件数を表示するので幅がほぼ変わらずガクつかない。
 */
export function GradeMenu({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = value.length > 0;

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
        学年{active && ` ${value.length}`}
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
            {GRADE_OPTIONS.map((g) => (
              <MenuRow
                key={g.value}
                label={g.label}
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
