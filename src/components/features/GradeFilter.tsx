"use client";

import { useState } from "react";
import { SlidersHorizontal, Check } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** 学年フィルタ（クライアント状態版。コンパクトなボタン＋シート） */
export function GradeFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = value !== "all";
  const label = active ? GRADE_OPTIONS.find((g) => g.value === value)?.short ?? "学年" : "学年";

  function select(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "h-8 px-3 rounded-full border text-[13px] font-semibold inline-flex items-center gap-1 shrink-0 active:opacity-60",
          active ? "bg-accent text-white border-accent" : "bg-card border-separator text-muted2",
        )}
      >
        <SlidersHorizontal size={14} />
        {label}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="学年でしぼり込み">
          <div className="pb-4 grid grid-cols-3 gap-2">
            <GradeChip label="すべて" active={value === "all"} onClick={() => select("all")} />
            {GRADE_OPTIONS.map((g) => (
              <GradeChip
                key={g.value}
                label={g.short}
                active={value === g.value}
                onClick={() => select(g.value)}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function GradeChip({
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
      onClick={onClick}
      className={cn(
        "h-11 rounded-xl border text-[14px] font-semibold inline-flex items-center justify-center gap-1 transition-active active:scale-[0.98]",
        active ? "border-accent bg-accent text-white" : "border-separator bg-card text-muted",
      )}
    >
      {active && <Check size={15} />}
      {label}
    </button>
  );
}
