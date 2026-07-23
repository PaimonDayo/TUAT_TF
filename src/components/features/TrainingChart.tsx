"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  subDays,
  subWeeks,
  subMonths,
  isSameDay,
  format,
} from "date-fns";
import { ja } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { KeyValue } from "@/components/ui/key-value";
import { SegmentedControl } from "@/components/ui/segmented";
import { INTENSITY_ORDER, INTENSITY_LABELS, CONDITIONS } from "@/lib/constants";
import { jstToday } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { PracticeRecord, Intensity } from "@/types";

type Period = "day" | "week" | "month";

const COUNTS: Record<Period, number> = { day: 35, week: 16, month: 12 };
const AREA = 84;
const VALUE_AREA = 16;
const CHART_HEIGHT = AREA + VALUE_AREA;

interface Bucket {
  start: Date;
  by: Record<Intensity, number>;
  total: number;
  records: PracticeRecord[];
}

function bucketStart(d: Date, period: Period): Date {
  if (period === "day") return startOfDay(d);
  if (period === "week") return startOfWeek(d, { weekStartsOn: 1 });
  return startOfMonth(d);
}

/** 練習量の推移。日/週/月を切り替え、横スライドで過去を遡れる。棒タップで内訳。 */
export function TrainingChart({
  records,
  showIntensitySummary = false,
}: {
  records: PracticeRecord[];
  showIntensitySummary?: boolean;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const [selected, setSelected] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const buckets = useMemo<Bucket[]>(() => {
    const count = COUNTS[period];
    const now = new Date();
    const arr: Bucket[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const base =
        period === "day" ? subDays(now, i) : period === "week" ? subWeeks(now, i) : subMonths(now, i);
      arr.push({ start: bucketStart(base, period), by: { low: 0, mid: 0, high: 0, speed: 0 }, total: 0, records: [] });
    }
    for (const r of records) {
      const start = bucketStart(new Date(r.recorded_date + "T00:00:00"), period);
      const b = arr.find((x) => isSameDay(x.start, start));
      if (!b) continue;
      b.by.low += r.dist_low;
      b.by.mid += r.dist_mid;
      b.by.high += r.dist_high;
      b.by.speed += r.dist_speed;
      b.records.push(r);
    }
    for (const b of arr) {
      b.total = Math.round((b.by.low + b.by.mid + b.by.high + b.by.speed) * 10) / 10;
    }
    return arr;
  }, [records, period]);

  const recentSummary = useMemo(() => {
    const from = jstToday(-6);
    const through = jstToday();
    const previousFrom = jstToday(-13);
    const previousThrough = jstToday(-7);
    const by: Record<Intensity, number> = { low: 0, mid: 0, high: 0, speed: 0 };
    const trainingDates = new Set<string>();
    let previousTotal = 0;
    for (const record of records) {
      const distances: Record<Intensity, number> = {
        low: record.dist_low ?? 0,
        mid: record.dist_mid ?? 0,
        high: record.dist_high ?? 0,
        speed: record.dist_speed ?? 0,
      };
      const recordTotal = INTENSITY_ORDER.reduce(
        (sum, intensity) => sum + distances[intensity],
        0,
      );
      if (record.recorded_date >= from && record.recorded_date <= through) {
        INTENSITY_ORDER.forEach((intensity) => {
          by[intensity] += distances[intensity];
        });
        if (recordTotal > 0) trainingDates.add(record.recorded_date);
      } else if (
        record.recorded_date >= previousFrom &&
        record.recorded_date <= previousThrough
      ) {
        previousTotal += recordTotal;
      }
    }
    const total = INTENSITY_ORDER.reduce((sum, intensity) => sum + by[intensity], 0);
    return {
      by,
      total,
      previousTotal,
      trainingDays: trainingDates.size,
      from,
      through,
    };
  }, [records]);

  const max = Math.max(...buckets.map((b) => b.total), 1);
  // 期間切替直後は前の選択番号が範囲外になりうるので必ず範囲内へ収める
  const rawIndex = selected ?? buckets.length - 1;
  const selIndex = rawIndex >= 0 && rawIndex < buckets.length ? rawIndex : buckets.length - 1;
  const sel = buckets[selIndex];

  // 期間切替・初期表示で右端（最新）までスクロール
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [period]);

  function changePeriod(next: Period) {
    setSelected(null);
    setShowDetail(false);
    setPeriod(next);
  }

  function bucketLabel(b: Bucket, long = false): string {
    if (period === "day") return format(b.start, long ? "M月d日(E)" : "M/d", { locale: ja });
    if (period === "week") return long ? `${format(b.start, "M/d", { locale: ja })}の週` : format(b.start, "M/d", { locale: ja });
    return format(b.start, long ? "yyyy年M月" : "M月", { locale: ja });
  }

  const labelEvery = period === "day" ? 5 : period === "week" ? 2 : 1;

  return (
    <Card className="p-4 space-y-3">
      {showIntensitySummary && <IntensitySummary summary={recentSummary} />}
      <div className="flex items-center justify-between">
        <p className="section-label">練習量の推移</p>
        <div className="w-36">
          <SegmentedControl
            items={[
              { key: "day", label: "日" },
              { key: "week", label: "週" },
              { key: "month", label: "月" },
            ]}
            value={period}
            onChange={(key) => changePeriod(key as Period)}
          />
        </div>
      </div>

      {/* 横スクロールできる棒グラフ */}
      <div ref={scrollRef} className="overflow-x-auto -mx-1 px-1">
        <div className="relative w-max">
          {/* 目盛り線 */}
          <div
            className="pointer-events-none absolute left-0 right-0 flex flex-col justify-between"
            style={{ height: `${AREA}px`, top: `${VALUE_AREA}px` }}
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="border-t border-separator/40" />
            ))}
          </div>

          {/* 棒 */}
          <div className="relative flex items-end gap-2" style={{ height: `${CHART_HEIGHT}px` }}>
            {buckets.map((b, i) => {
              const barH = b.total > 0 ? Math.max((b.total / max) * AREA, 6) : 0;
              const isSel = i === selIndex;
              return (
                <button
                  key={i}
                  onClick={() => {
                    setSelected(i);
                    setShowDetail(false);
                  }}
                  className="relative h-full w-6 shrink-0"
                >
                  {barH > 0 ? (
                    <>
                      <span
                        className={cn(
                          "absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] font-semibold tabular-nums",
                          isSel ? "text-accent" : "text-muted2",
                        )}
                        style={{ bottom: `${barH + 3}px` }}
                      >
                        {formatDistance(b.total)}
                      </span>
                      <div
                        className={cn(
                          "absolute bottom-0 left-0 flex w-full flex-col-reverse overflow-hidden rounded-t-[4px] border shadow-sm transition-all",
                          isSel ? "border-accent ring-2 ring-inset ring-accent/60" : "border-separator/70 opacity-95",
                        )}
                        style={{ height: `${barH}px` }}
                      >
                        {INTENSITY_ORDER.map((k) =>
                          b.by[k] > 0 ? (
                            <div
                              key={k}
                              style={{
                                height: `${(b.by[k] / b.total) * 100}%`,
                                backgroundColor: INTENSITY_LABELS[k].color,
                              }}
                            />
                          ) : null,
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="absolute bottom-0 h-1 w-full rounded-t-[3px] bg-separator/60" />
                  )}
                </button>
              );
            })}
          </div>

          {/* ラベル（間引き） */}
          <div className="flex gap-2 mt-1.5">
            {buckets.map((b, i) => {
              const show = (buckets.length - 1 - i) % labelEvery === 0;
              return (
                <div key={i} className="shrink-0 w-6 text-center">
                  {show && (
                    <span className={cn("text-[9px]", i === selIndex ? "text-accent font-bold" : "text-muted2")}>
                      {bucketLabel(b)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 選択した期間の内訳（枠の高さは固定） */}
      {(() => {
        const hasText = sel.records.some(
          (r) => r.result_text || r.strength_text || r.memo || r.condition,
        );
        return (
          <div className="rounded-xl bg-bg p-3">
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-[12px] font-semibold">{bucketLabel(sel, true)}</p>
              <p className="text-[13px] font-bold tabular-nums">
                {sel.total}
                <span className="text-caption ml-0.5">km</span>
              </p>
            </div>

            {/* 内訳エリア（高さ固定で日ごとにガタつかない） */}
            <div className="h-9 overflow-hidden">
              {sel.total > 0 ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {INTENSITY_ORDER.map((k) =>
                    sel.by[k] > 0 ? (
                      <span key={k} className="flex items-center gap-1 text-[12px] text-muted2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: INTENSITY_LABELS[k].color }} />
                        {INTENSITY_LABELS[k].label} {Math.round(sel.by[k] * 10) / 10}km
                      </span>
                    ) : null,
                  )}
                </div>
              ) : (
                <p className="text-caption">この期間は記録がありません</p>
              )}
            </div>

            {hasText && (
              <Disclosure
                title="詳細"
                open={showDetail}
                onOpenChange={setShowDetail}
                className="mt-1"
              >
                  <div className="space-y-2">
                    {sel.records.map((r) => {
                      const cond = r.condition ? CONDITIONS[r.condition] : null;
                      return (
                        <div key={r.id} className="text-[12px] space-y-0.5">
                          {period !== "day" && (
                            <p className="font-semibold flex items-center gap-1.5">
                              {format(new Date(r.recorded_date + "T00:00:00"), "M/d(E)", { locale: ja })}
                              {cond && (
                                <span style={{ color: cond.color }}>
                                  {cond.symbol} {cond.label}
                                </span>
                              )}
                            </p>
                          )}
                          {period === "day" && cond && (
                            <p className="font-semibold" style={{ color: cond.color }}>
                              {cond.symbol} {cond.label}
                            </p>
                          )}
                          <dl>
                            <KeyValue label="結果" value={r.result_text} />
                            <KeyValue label="補強" value={r.strength_text} />
                            <KeyValue label="感想" value={r.memo} />
                          </dl>
                        </div>
                      );
                    })}
                  </div>
              </Disclosure>
            )}
          </div>
        );
      })()}
    </Card>
  );
}

function formatDistance(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function IntensitySummary({
  summary,
}: {
  summary: {
    by: Record<Intensity, number>;
    total: number;
    previousTotal: number;
    trainingDays: number;
    from: string;
    through: string;
  };
}) {
  const difference = summary.total - summary.previousTotal;
  const comparison =
    summary.previousTotal === 0
      ? summary.total > 0
        ? "前の7日は記録なし"
        : null
      : Math.abs(difference) < 0.05
        ? "前の7日と同じ"
        : `前の7日より ${difference > 0 ? "+" : ""}${formatDistance(difference)}km`;
  const dateRange = `${format(new Date(`${summary.from}T00:00:00`), "M/d")}–${format(
    new Date(`${summary.through}T00:00:00`),
    "M/d",
  )}`;

  return (
    <div className="rounded-xl bg-bg p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="section-label">走行サマリー</p>
        <p className="text-micro tabular-nums">{dateRange}</p>
      </div>

      <div className="mt-2">
        <p className="text-2xl font-bold leading-none tabular-nums">
          {formatDistance(summary.total)}
          <span className="ml-1 text-caption">km</span>
        </p>
        {summary.total > 0 || comparison ? (
          <p className="mt-1.5 text-caption tabular-nums">
            {comparison && (
              <>
                {comparison}
                <span className="mx-1.5 text-muted" aria-hidden="true">
                  ・
                </span>
              </>
            )}
            走行{summary.trainingDays}日
          </p>
        ) : (
          <p className="mt-1.5 text-caption">この期間の走行記録はありません</p>
        )}
      </div>

      {summary.total > 0 && (
        <>
          <div
            className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-separator/60"
            role="img"
            aria-label="強度別の走行距離割合"
          >
            {INTENSITY_ORDER.map((intensity) =>
              summary.by[intensity] > 0 ? (
                <div
                  key={intensity}
                  style={{
                    width: `${(summary.by[intensity] / summary.total) * 100}%`,
                    backgroundColor: INTENSITY_LABELS[intensity].color,
                  }}
                />
              ) : null,
            )}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
            {INTENSITY_ORDER.map((intensity) => {
              const value = summary.by[intensity];
              const percent = Math.round((value / summary.total) * 100);
              return (
                <div key={intensity} className="flex min-w-0 items-center gap-1.5 text-[11px]">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: INTENSITY_LABELS[intensity].color }}
                  />
                  <span className="truncate text-muted2">{INTENSITY_LABELS[intensity].label}</span>
                  <span className="ml-auto shrink-0 font-semibold tabular-nums">
                    {percent}%
                    <span className="ml-1 font-normal text-muted">{formatDistance(value)}km</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
