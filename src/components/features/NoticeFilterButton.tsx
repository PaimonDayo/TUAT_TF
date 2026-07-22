"use client";

import type { ReactNode } from "react";
import { Check, RotateCcw, SlidersHorizontal } from "lucide-react";
import { NOTICE_CATEGORIES } from "@/lib/constants";
import {
  noticeFilterCount,
  type NoticeAcknowledgementFilter,
  type NoticeDeadlineFilter,
  type NoticeFilters,
} from "@/lib/notice-filters";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import type { NoticeCategory } from "@/types";

const DEADLINE_OPTIONS: { value: NoticeDeadlineFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "open", label: "受付中" },
  { value: "ended", label: "終了" },
  { value: "none", label: "期限なし" },
];

const ACKNOWLEDGEMENT_OPTIONS: { value: NoticeAcknowledgementFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "unacknowledged", label: "未確認" },
  { value: "acknowledged", label: "確認済み" },
];

export function NoticeFilterButton({
  filters,
  onChange,
  onReset,
}: {
  filters: NoticeFilters;
  onChange: (filters: NoticeFilters) => void;
  onReset: () => void;
}) {
  const count = noticeFilterCount(filters);

  function toggleCategory(category: NoticeCategory) {
    onChange({
      ...filters,
      categories: filters.categories.includes(category)
        ? filters.categories.filter((item) => item !== category)
        : [...filters.categories, category],
    });
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold",
            count > 0
              ? "border-accent bg-accent text-white"
              : "border-separator bg-card text-muted2",
          )}
        >
          <SlidersHorizontal size={15} />
          絞り込み{count > 0 ? ` ${count}` : ""}
        </button>
      </SheetTrigger>

      <SheetContent title="お知らせを絞り込み" autoFocus={false}>
        <div className="max-h-[68vh] space-y-5 overflow-y-auto pb-5">
          <FilterSection title="カテゴリ（複数選択可）">
            {(Object.keys(NOTICE_CATEGORIES) as NoticeCategory[]).map((category) => (
              <FilterRow
                key={category}
                label={NOTICE_CATEGORIES[category].label}
                checked={filters.categories.includes(category)}
                onClick={() => toggleCategory(category)}
              />
            ))}
          </FilterSection>

          <FilterSection title="期限">
            {DEADLINE_OPTIONS.map((option) => (
              <FilterRow
                key={option.value}
                label={option.label}
                checked={filters.deadline === option.value}
                onClick={() => onChange({ ...filters, deadline: option.value })}
              />
            ))}
          </FilterSection>

          <FilterSection title="確認状態">
            {ACKNOWLEDGEMENT_OPTIONS.map((option) => (
              <FilterRow
                key={option.value}
                label={option.label}
                checked={filters.acknowledgement === option.value}
                onClick={() => onChange({ ...filters, acknowledgement: option.value })}
              />
            ))}
          </FilterSection>

          <button
            type="button"
            onClick={onReset}
            disabled={count === 0}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted disabled:opacity-40"
          >
            <RotateCcw size={15} />
            絞り込みを解除
          </button>

          <SheetClose asChild>
            <Button type="button" size="lg">完了</Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="section-label mb-2">{title}</p>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function FilterRow({
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
      aria-pressed={checked}
      className={cn(
        "flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm",
        checked ? "bg-accent/10 font-semibold text-ink" : "text-muted2 active:bg-bg",
      )}
    >
      <span className="flex-1">{label}</span>
      {checked && <Check size={18} className="text-accent" />}
    </button>
  );
}
