"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * 学年フィルター（シート式・複数選択）。アプリ規約「選ぶ＝シート」に準拠。
 * メンバー一覧・タイムラインで共通利用する。空配列＝全学年。
 * 選択中はボタンを色だけ変える（幅は変えない＝ガクつかない）。
 */
export function GradeFilter({
  value,
  onChange,
  availableGrades,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  /** 指定すると、この学年（値）だけを選択肢に出す（在籍者がいる学年のみ用途） */
  availableGrades: string[];
}) {
  const [open, setOpen] = useState(false);
  const active = value.length > 0;
  const options = availableGrades
    ? GRADE_OPTIONS.filter((g) => availableGrades.includes(g.value))
    : GRADE_OPTIONS;

  if (options.length === 0) return null;

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((g) => g !== v) : [...value, v]);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="学年でしぼり込み"
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border pl-3 pr-2 text-[13px] font-semibold active:opacity-60",
          active ? "border-accent bg-accent text-white" : "border-separator bg-card text-muted2",
        )}
      >
        学年
        <ChevronDown size={14} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="学年でしぼり込み">
          <div className="max-h-[60vh] overflow-y-auto pb-4">
            <p className="px-1 pb-3 text-micro">
              {"\u672a\u9078\u629e\u306e\u5834\u5408\u306f\u3059\u3079\u3066\u8868\u793a\u3057\u307e\u3059"}
            </p>
            {options.map((g) => (
              <Row
                key={g.value}
                label={g.short}
                checked={value.includes(g.value)}
                onClick={() => toggle(g.value)}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Row({
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
      className="flex min-h-12 w-full items-center justify-between border-t border-separator/70 px-1 text-left text-[15px] first:border-t-0 active:bg-bg"
    >
      <span className={cn(checked ? "font-semibold text-ink" : "text-muted2")}>{label}</span>
      {checked && <Check size={18} className="shrink-0 text-accent" />}
    </button>
  );
}
