"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented";
import { GRADE_OPTIONS, SIMPLE_BLOCK_ITEMS, gradeShort, matchSimpleBlock, type SimpleBlockFilter } from "@/lib/constants";
import { formatKm } from "@/lib/utils";
import type { DailyRecord, DailyRecordMember } from "@/lib/queries";

const gradeRank = (grade: string | null) => {
  const index = GRADE_OPTIONS.findIndex((g) => g.value === grade);
  return index < 0 ? GRADE_OPTIONS.length : index;
};
const byGradeThenName = (a: DailyRecordMember, b: DailyRecordMember) =>
  gradeRank(a.grade) - gradeRank(b.grade) || a.display_name.localeCompare(b.display_name, "ja");

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1日分の全員の記録。学年→名前の順。タップでその記録を開く。 */
export function DailyRecordsView({
  date,
  today,
  records,
  missing,
}: {
  date: string;
  today: string;
  records: DailyRecord[];
  missing: DailyRecordMember[];
}) {
  const router = useRouter();
  const [block, setBlock] = useState<SimpleBlockFilter>("all");
  const visible = records
    .filter((r) => matchSimpleBlock(r.author.blocks, block))
    .sort((a, b) => byGradeThenName(a.author, b.author));
  const visibleMissing = missing.filter((m) => matchSimpleBlock(m.blocks, block)).sort(byGradeThenName);
  const label = format(new Date(`${date}T00:00:00`), "M月d日(E)", { locale: ja });

  return (
    <div className="space-y-4 px-4 pb-8 pt-2">
      <Card className="flex items-center gap-2 p-2">
        <Link href={`/mypage/daily-records?date=${shiftDate(date, -1)}`} aria-label="前の日" className="rounded-lg p-2 pressable">
          <ChevronLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-headline">{label}</p>
          {date !== today && (
            <Link href="/mypage/daily-records" className="text-caption text-accent">今日へ</Link>
          )}
        </div>
        {date < today ? (
          <Link href={`/mypage/daily-records?date=${shiftDate(date, 1)}`} aria-label="次の日" className="rounded-lg p-2 pressable">
            <ChevronRight size={20} />
          </Link>
        ) : (
          <span className="p-2 text-muted/40" aria-hidden><ChevronRight size={20} /></span>
        )}
      </Card>
      <Input
        type="date"
        aria-label="日付を選ぶ"
        value={date}
        max={today}
        onChange={(e) => e.target.value && router.push(`/mypage/daily-records?date=${e.target.value}`)}
      />
      <SegmentedControl items={SIMPLE_BLOCK_ITEMS} value={block} onChange={setBlock} />

      <section className="space-y-1.5">
        <p className="section-label">記録（{visible.length}人）</p>
        {visible.length === 0 ? (
          <Card><EmptyState title="この日の記録はありません" /></Card>
        ) : (
          <Card className="divide-y divide-separator">
            {visible.map((r) => (
              <Link key={r.id} href={`/timeline/record/${r.id}`} className="block p-3.5 pressable">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-headline break-words">
                    <span className="mr-1.5 text-caption text-muted2">{gradeShort(r.author.grade)}</span>
                    {r.author.display_name}
                  </span>
                  {r.distance > 0 && <span className="shrink-0 text-title tabular-nums">{formatKm(r.distance)}km</span>}
                </p>
                {(r.menu_text || r.result_text) && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-body line-clamp-2">
                    {[r.menu_text, r.result_text].filter(Boolean).join(" / ")}
                  </p>
                )}
                {r.memo && <p className="mt-1 whitespace-pre-wrap break-words text-caption text-muted2 line-clamp-2">{r.memo}</p>}
              </Link>
            ))}
          </Card>
        )}
      </section>

      {visibleMissing.length > 0 && (
        <section className="space-y-1.5">
          <p className="section-label">未入力（{visibleMissing.length}人）</p>
          <Card className="p-3.5 text-body leading-relaxed">
            {visibleMissing.map((m) => `${gradeShort(m.grade) ?? ""} ${m.display_name}`.trim()).join("・")}
          </Card>
        </section>
      )}
    </div>
  );
}
