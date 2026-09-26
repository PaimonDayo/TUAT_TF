"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented";
import { SIMPLE_BLOCK_ITEMS, gradeShort, matchSimpleBlock, type SimpleBlockFilter } from "@/lib/constants";
import { formatRecord, formatWind, measureTypeOf, timeFormatOf } from "@/lib/competition-record";
import type { CompetitionEvent } from "@/lib/competition-goals";
import type { MonthlyResult } from "@/lib/queries";

const PATH = "/mypage/monthly-results";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 1か月分の大会・記録会の結果。大会（日付＋大会名）ごとにまとめ、新しい日付を上に。 */
export function MonthlyResultsView({
  month,
  current,
  results,
  events,
}: {
  month: string;
  current: string;
  results: MonthlyResult[];
  events: CompetitionEvent[];
}) {
  const [block, setBlock] = useState<SimpleBlockFilter>("all");
  const visible = results.filter((r) => matchSimpleBlock(r.author?.blocks, block));
  const groups = new Map<string, { date: string; meet: string; rows: MonthlyResult[] }>();
  for (const r of visible) {
    const meet = r.competition?.name ?? r.meet_name ?? "大会名なし";
    const key = `${r.recorded_on} ${meet}`;
    const group = groups.get(key) ?? { date: r.recorded_on ?? "", meet, rows: [] };
    group.rows.push(r);
    groups.set(key, group);
  }
  const eventIndex = (name: string) => {
    const i = events.findIndex((e) => e.name === name);
    return i < 0 ? events.length : i;
  };
  const [y, m] = month.split("-").map(Number);

  return (
    <div className="space-y-4 px-4 pb-8 pt-2">
      <Card className="flex items-center gap-2 p-2">
        <Link href={`${PATH}?month=${shiftMonth(month, -1)}`} aria-label="前の月" className="rounded-lg p-2 pressable">
          <ChevronLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-headline">{y}年{m}月</p>
          {month !== current && <Link href={PATH} className="text-caption text-accent">今月へ</Link>}
        </div>
        {month < current ? (
          <Link href={`${PATH}?month=${shiftMonth(month, 1)}`} aria-label="次の月" className="rounded-lg p-2 pressable">
            <ChevronRight size={20} />
          </Link>
        ) : (
          <span className="p-2 text-muted/40" aria-hidden><ChevronRight size={20} /></span>
        )}
      </Card>
      <SegmentedControl items={SIMPLE_BLOCK_ITEMS} value={block} onChange={setBlock} />
      <p className="text-caption">{visible.length}件（大学の結果で、記録日が入っているもの）</p>

      {groups.size === 0 ? (
        <Card><EmptyState title="この月の大会・記録会の結果はありません" /></Card>
      ) : (
        [...groups.values()].map((group) => (
          <section key={`${group.date} ${group.meet}`} className="space-y-1.5">
            <p className="flex items-baseline gap-2 text-caption font-semibold text-muted2">
              <span className="tabular-nums">{Number(group.date.slice(5, 7))}/{Number(group.date.slice(8, 10))}</span>
              <span className="min-w-0 break-words">{group.meet}</span>
              <span className="font-normal text-muted">{group.rows.length}件</span>
            </p>
            <Card className="divide-y divide-separator">
              {group.rows
                .sort((a, b) => eventIndex(a.event_name) - eventIndex(b.event_name) || (a.author?.display_name ?? "").localeCompare(b.author?.display_name ?? "", "ja"))
                .map((r) => (
                  <div key={r.id} className="flex items-center gap-3 p-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-headline break-words">
                        <span className="mr-1.5 text-caption text-muted2">{gradeShort(r.author?.grade ?? null)}</span>
                        {r.author?.display_name ?? "部員"}
                      </p>
                      <p className="flex flex-wrap items-center gap-1.5 text-caption">
                        {r.event_name}
                        {r.wind !== null && r.wind !== undefined && <span>風速 {formatWind(r.wind)}</span>}
                        {r.is_pb && <span className="rounded border border-warning px-1 text-[10px] font-bold leading-tight text-warning">PB</span>}
                        {r.is_ub && <span className="rounded border border-accent px-1 text-[10px] font-bold leading-tight text-accent">UB</span>}
                        {r.is_official && <span className="rounded border border-success px-1 text-[10px] font-bold leading-tight text-success">公認</span>}
                      </p>
                    </div>
                    <span className="text-title tabular-nums">
                      {formatRecord(r, measureTypeOf(events, r.event_name), timeFormatOf(events, r.event_name))}
                    </span>
                  </div>
                ))}
            </Card>
          </section>
        ))
      )}
    </div>
  );
}
