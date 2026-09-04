"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

function shiftMonth(month: string, amount: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function RankingMonthNav({
  month,
  currentMonth,
}: {
  month: string;
  currentMonth: string;
}) {
  const [year, monthNumber] = month.split("-").map(Number);
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const canGoNext = next <= currentMonth;

  return (
    <div className="flex items-center justify-between rounded-[16px] border border-separator bg-card p-1">
      <Link
        href={`/ranking?month=${previous}`}
        prefetch={false}
        replace
        aria-label="前の月"
        className="grid h-10 w-10 place-items-center rounded-xl text-accent active:bg-bg"
      >
        <ChevronLeft size={20} />
      </Link>
      <div className="text-center">
        <p className="text-[15px] font-semibold tabular-nums">{year}年{monthNumber}月</p>
        <p className="text-micro">月別ランキング</p>
      </div>
      {canGoNext ? (
        <Link
          href={`/ranking?month=${next}`}
          prefetch={false}
          replace
          aria-label="次の月"
          className="grid h-10 w-10 place-items-center rounded-xl text-accent active:bg-bg"
        >
          <ChevronRight size={20} />
        </Link>
      ) : (
        <span className="h-10 w-10" aria-hidden="true" />
      )}
    </div>
  );
}
