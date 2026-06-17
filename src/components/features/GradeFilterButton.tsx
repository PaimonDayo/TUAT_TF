"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SlidersHorizontal, Check } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** 学年フィルタ（コンパクトなボタン＋シート。タブを増やさない） */
export function GradeFilterButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("grade") ?? "all";
  const [open, setOpen] = useState(false);

  const label = current === "all" ? "学年" : GRADE_OPTIONS.find((g) => g.value === current)?.short ?? "学年";
  const active = current !== "all";

  function select(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value === "all") sp.delete("grade");
    else sp.set("grade", value);
    router.push(`${pathname}?${sp.toString()}`);
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
            <GradeChip label="すべて" active={current === "all"} onClick={() => select("all")} />
            {GRADE_OPTIONS.map((g) => (
              <GradeChip
                key={g.value}
                label={g.short}
                active={current === g.value}
                onClick={() => select(g.value)}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function GradeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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
