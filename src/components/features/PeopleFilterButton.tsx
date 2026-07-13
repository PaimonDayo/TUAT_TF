"use client";

import { Check, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { BLOCK_ORDER, BLOCKS, GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Block } from "@/types";
import { useState } from "react";

export function PeopleFilterButton({ blocks, grades, onBlocksChange, onGradesChange, availableGrades }: { blocks: Block[]; grades: string[]; onBlocksChange: (value: Block[]) => void; onGradesChange: (value: string[]) => void; availableGrades: string[] }) {
  const [open, setOpen] = useState(false);
  const count = blocks.length + grades.length;
  const gradeOptions = GRADE_OPTIONS.filter((grade) => availableGrades.includes(grade.value));
  return <>
    <button type="button" onClick={() => setOpen(true)} className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold", count ? "border-accent bg-accent text-white" : "border-separator bg-card text-muted2")}>
      <SlidersHorizontal size={14} />絞り込み{count ? ` ${count}` : ""}
    </button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent title="部員を絞り込み" autoFocus={false}>
        <div className="space-y-5 pb-5">
          <section><p className="section-label mb-2">ブロック（複数選択可）</p><div className="space-y-1">{BLOCK_ORDER.map((block) => <FilterRow key={block} label={BLOCKS[block].label} checked={blocks.includes(block)} onClick={() => onBlocksChange(blocks.includes(block) ? blocks.filter((item) => item !== block) : [...blocks, block])} />)}</div></section>
          {gradeOptions.length > 0 && <section><p className="section-label mb-2">学年（複数選択可）</p><div className="space-y-1">{gradeOptions.map((grade) => <FilterRow key={grade.value} label={grade.short} checked={grades.includes(grade.value)} onClick={() => onGradesChange(grades.includes(grade.value) ? grades.filter((item) => item !== grade.value) : [...grades, grade.value])} />)}</div></section>}
          <button type="button" onClick={() => { onBlocksChange([]); onGradesChange([]); }} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted"><RotateCcw size={15} />絞り込みを解除</button>
        </div>
      </SheetContent>
    </Sheet>
  </>;
}

function FilterRow({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn("flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm", checked ? "bg-accent/10 font-semibold text-ink" : "active:bg-bg text-muted2")}><span className="flex-1">{label}</span>{checked && <Check size={18} className="text-accent" />}</button>;
}